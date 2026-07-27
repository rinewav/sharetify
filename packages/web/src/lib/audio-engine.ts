import type { Track } from "@musicshare/shared";
import { attachBackend, usePlayer } from "./player-store.js";
import { artworkUrl, canStreamDirectly, fetchTrackBlob, streamUrl } from "./node-client.js";
import { getCached, putCached } from "./offline-cache.js";
import { useSession } from "./session-store.js";
import { trackProgressed, trackStarted } from "./scrobbler.js";

/**
 * 実際の再生を担う層。
 *
 * 再生装置を 2 つ持ち、交互に使う。曲の終わりが近づいたら次を裏で鳴らし始め、
 * 音量を入れ替えて繋ぐ。1 つで差し替えると切れ目に雑音が乗るので、
 * 重ねてしまうほうが素直に消える。
 *
 * iOS を主対象に置いた都合で、守っている約束がいくつかある。
 *
 *   1. 再生装置はアプリを通して作り直さない。
 *      曲ごとに作り直すと、最初の操作で得た再生許可を失って以降鳴らなくなる。
 *   2. 曲を切り替えるとき、経路が中継なら URL の解決を待たない。
 *      待つと操作から時間が空き、その間に再生許可が切れる。
 *   3. 最初のユーザー操作で無音を一度鳴らして許可を得ておく。
 */

/** 0.05 秒の無音。再生許可を取るためだけに使う。 */
const SILENCE =
  "data:audio/wav;base64,UklGRkQDAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YSADAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==";

/** 曲を繋ぐ長さ。長すぎると混ざりすぎるので短めに。 */
const CROSSFADE_MS = 2200;
/** 次の曲を用意し始める余裕。直結では受け取りきるまで時間がかかる。 */
const PREFETCH_LEAD_MS = 20_000;
/** 再生開始と停止に噛ませる長さ。頭の雑音が消える。 */
const EDGE_FADE_MS = 120;
/** 音量を変える刻み。 */
const FADE_STEP_MS = 40;

interface Deck {
  el: HTMLAudioElement;
  trackId: string | null;
  objectUrl: string | null;
}

class AudioEngine {
  private decks: [Deck, Deck] | null = null;
  private active = 0;
  private unlocked = false;
  private unlocking = false;
  private playWhenUnlocked = false;
  /** 先読みを重ねて走らせないための目印。 */
  private prefetchingId: string | null = null;
  /** 聴取記録に知らせ済みの曲。同じ曲で二度送らないための目印。 */
  private announcedTrackId: string | null = null;
  private crossfading = false;
  private fadeTimers = new Set<ReturnType<typeof setInterval>>();

  init(): void {
    if (this.decks) return;

    const make = (): Deck => {
      const el = document.createElement("audio");
      el.preload = "auto";
      // インライン再生を明示しないと、全画面の再生画面に奪われる。
      el.setAttribute("playsinline", "");
      el.setAttribute("webkit-playsinline", "");
      el.style.display = "none";
      document.body.appendChild(el);
      return { el, trackId: null, objectUrl: null };
    };

    this.decks = [make(), make()];
    this.wireDeck(0);
    this.wireDeck(1);

    attachBackend({
      play: () => this.play(),
      pause: () => this.pause(),
      seek: (positionMs) => this.seek(positionMs),
      setVolume: (volume, muted) => this.applyVolume(volume, muted),
      setRate: (rate) => this.applyRate(rate),
    });

    this.registerMediaSessionHandlers();
  }

  private get current(): Deck {
    return this.decks![this.active]!;
  }

  private get standby(): Deck {
    return this.decks![this.active === 0 ? 1 : 0]!;
  }

  private wireDeck(index: number): void {
    const deck = this.decks![index]!;
    const el = deck.el;

    el.addEventListener("timeupdate", () => {
      if (index !== this.active) return;
      const positionMs = el.currentTime * 1000;
      const player = usePlayer.getState();
      player.reportPosition(positionMs);
      // 時刻が進んでいるなら確かに鳴っている。待ちの表示が残っていたら解く。
      if (player.loading && !el.paused) player.reportLoading(false);
      this.syncPositionState();

      const track = usePlayer.getState().current();
      if (track && Number.isFinite(el.duration)) {
        trackProgressed(track, positionMs, el.duration * 1000);
      }

      void this.considerCrossfade();
    });

    el.addEventListener("loadedmetadata", () => {
      if (index !== this.active) return;
      if (Number.isFinite(el.duration)) {
        usePlayer.getState().reportDuration(el.duration * 1000);
      }
      this.syncPositionState();
    });

    el.addEventListener("playing", () => {
      if (index !== this.active) return;
      const player = usePlayer.getState();
      player.reportPlaying(true);
      player.reportLoading(false);
      player.reportError(null);
      this.syncMediaSession();

      // 曲が変わった最初の一回だけ知らせる。再開のたびに送らない。
      const track = player.current();
      if (track && this.announcedTrackId !== track.id) {
        this.announcedTrackId = track.id;
        trackStarted(track);
      }
    });

    el.addEventListener("pause", () => {
      // 繋いでいる最中の停止は表に出さない。裏方の動きなので。
      if (index !== this.active || this.crossfading) return;
      usePlayer.getState().reportPlaying(false);
      this.syncMediaSession();
    });

    el.addEventListener("waiting", () => {
      if (index === this.active) usePlayer.getState().reportLoading(true);
    });
    el.addEventListener("canplay", () => {
      if (index === this.active) usePlayer.getState().reportLoading(false);
    });

    el.addEventListener("ended", () => {
      // 繋ぎが間に合った場合はここに来ない。来たときは素直に次へ。
      if (index !== this.active || this.crossfading) return;
      usePlayer.getState().handleEnded();
    });

    el.addEventListener("error", () => {
      if (this.unlocking || index !== this.active) return;
      usePlayer.getState().reportError(describeMediaError(el.error));
      usePlayer.getState().reportPlaying(false);
    });
  }

  /**
   * 最初のユーザー操作から呼ぶ。
   * 無音を一瞬鳴らして再生許可を得ておくと、以降は操作から離れた文脈でも鳴らせる。
   */
  unlock(): void {
    if (this.unlocked || this.unlocking || !this.decks) return;

    // 既に何か読み込んでいるなら、その再生を殺さないよう触らない。
    if (this.current.trackId !== null) {
      this.unlocked = true;
      return;
    }

    this.unlocking = true;
    // 2 つとも許可を取っておく。繋ぎのときに裏側が鳴らないと意味がない。
    const attempts = this.decks.map((deck) => {
      deck.el.src = SILENCE;
      deck.el.volume = 0;
      return deck.el
        .play()
        .then(() => {
          deck.el.pause();
          deck.el.currentTime = 0;
        })
        .catch(() => undefined);
    });

    void Promise.all(attempts).finally(() => {
      this.unlocking = false;
      this.unlocked = true;
      const player = usePlayer.getState();
      this.current.el.volume = player.muted ? 0 : player.volume;
      if (this.playWhenUnlocked) {
        this.playWhenUnlocked = false;
        this.play();
      }
    });
  }

  private play(): void {
    if (!this.decks) return;

    const player = usePlayer.getState();
    const track = player.current();
    if (!track) return;

    if (!this.unlocked) {
      this.playWhenUnlocked = true;
      this.unlock();
      return;
    }

    if (this.current.trackId !== track.id) {
      void this.loadInto(this.current, track).then((ok) => {
        if (ok) this.startPlayback();
      });
      return;
    }

    this.startPlayback();
  }

  /** 指定した装置に曲を用意する。用意できたら true。 */
  private async loadInto(deck: Deck, track: Track): Promise<boolean> {
    deck.trackId = track.id;

    if (deck === this.current) {
      usePlayer.getState().reportDuration(0);
      usePlayer.getState().reportLoading(true);
      this.syncMediaSession();
    }


    this.releaseObjectUrl(deck);

    try {
      // 手元にあるならそれで済ませる。取りに行かない分だけ速く、
      // PC が落ちていても鳴らせるのはこの経路があるから。
      const stored = await getCached(track.id);
      if (stored) {
        if (deck.trackId !== track.id) return false;
        const url = URL.createObjectURL(stored);
        deck.objectUrl = url;
        deck.el.src = url;
        deck.el.load();
        reportReadiness(track.id, true);
        return true;
      }

      if (canStreamDirectly()) {
        // 中継経路では URL をそのまま渡せる。解決を待たないので頭出しが速い。
        deck.el.src = streamUrl(track.id);
      } else {
        // 直結では一度受け取りきる。待つあいだに曲が変わっていたら捨てる。
        const { url, blob } = await fetchTrackBlob(track.id);
        if (deck.trackId !== track.id) {
          URL.revokeObjectURL(url);
          return false;
        }
        deck.objectUrl = url;
        deck.el.src = url;
        // 受け取ったものは残す。次からは上の分岐で拾われる。
        void putCached(track.id, blob);
      }
      deck.el.load();
      // 一緒に聴いている場に、この曲を出せることを伝える。
      reportReadiness(track.id, true);
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : "曲を取得できませんでした。";
      if (deck === this.current) {
        usePlayer.getState().reportError(message);
        usePlayer.getState().reportPlaying(false);
      }
      // 出せないことも伝える。黙ると相手側でずっと待つことになる。
      reportReadiness(track.id, false, message);
      deck.trackId = null;
      return false;
    }
  }

  private startPlayback(): void {
    const player = usePlayer.getState();
    const target = player.muted ? 0 : player.volume;
    const el = this.current.el;

    player.reportLoading(true);
    // 無音から立ち上げる。いきなり最大で始めると頭が弾ける。
    el.volume = 0;

    void el
      .play()
      .then(() => {
        /*
         * 鳴り始めたら待ちを解く。
         *
         * 既に鳴っている装置に頼み直したときは playing の知らせが来ないので、
         * それだけを当てにしていると輪が回り続けたままになる。
         */
        usePlayer.getState().reportLoading(false);
        this.fade(el, target, EDGE_FADE_MS);
      })
      .catch((error: unknown) => {
        usePlayer.getState().reportError(describePlayRejection(error));
        usePlayer.getState().reportPlaying(false);
        usePlayer.getState().reportLoading(false);
      });

    this.syncMediaSession();
  }

  private pause(): void {
    const el = this.current.el;
    // 切るときも一度落としてから止める。
    this.fade(el, 0, EDGE_FADE_MS, () => el.pause());
  }

  private seek(positionMs: number): void {
    const el = this.current.el;
    if (el.readyState === 0) {
      el.addEventListener(
        "loadedmetadata",
        () => {
          el.currentTime = positionMs / 1000;
        },
        { once: true },
      );
      return;
    }
    el.currentTime = positionMs / 1000;
    this.syncPositionState();
  }

  /**
   * 送りの速さをわずかに変える。
   *
   * 一緒に聴いているときの小さなずれを、跳ばさずに詰めるために使う。
   * 数 % なら音の高さは変わって聞こえないので、詰めていることに気付かれない。
   */
  private applyRate(rate: number): void {
    if (!this.decks) return;
    const el = this.current.el;
    if (Math.abs(el.playbackRate - rate) < 0.001) return;
    el.playbackRate = rate;
  }

  private applyVolume(volume: number, muted: boolean): void {
    if (!this.decks) return;
    // 繋いでいる最中は音量比を崩さない。落ち着いてから反映する。
    if (this.crossfading) return;
    this.current.el.volume = muted ? 0 : volume;
  }

  /* ------------------------------ 曲の繋ぎ ------------------------------ */

  /** 残り時間を見て、先読みと繋ぎを始める。 */
  private async considerCrossfade(): Promise<void> {
    if (this.crossfading) return;

    const player = usePlayer.getState();
    if (!player.playing || player.repeat === "one") return;

    const el = this.current.el;
    if (!Number.isFinite(el.duration) || el.duration <= 0) return;

    const remainingMs = (el.duration - el.currentTime) * 1000;
    const next = player.peekNext();
    if (!next) return;

    // 先に用意しておく。直結では受け取りきるまで時間がかかるので早めに。
    if (remainingMs <= PREFETCH_LEAD_MS && this.prefetchingId !== next.id) {
      this.prefetchingId = next.id;
      void this.loadInto(this.standby, next);
      return;
    }

    if (remainingMs > CROSSFADE_MS) return;
    if (this.standby.trackId !== next.id) return;

    await this.beginCrossfade();
  }

  private async beginCrossfade(): Promise<void> {
    if (this.crossfading) return;
    this.crossfading = true;

    const player = usePlayer.getState();
    const target = player.muted ? 0 : player.volume;
    const outgoing = this.current;
    const incoming = this.standby;

    incoming.el.volume = 0;
    incoming.el.currentTime = 0;

    try {
      await incoming.el.play();
    } catch {
      // 裏側が鳴らせないなら、繋がずに通常の切り替えへ委ねる。
      this.crossfading = false;
      return;
    }

    // 表示上の曲は先に入れ替える。耳より目のほうが遅れて気付きやすい。
    this.active = this.active === 0 ? 1 : 0;
    this.prefetchingId = null;
    usePlayer.getState().advanceToNext();
    this.syncMediaSession();

    this.fade(outgoing.el, 0, CROSSFADE_MS, () => {
      outgoing.el.pause();
      this.releaseObjectUrl(outgoing);
      outgoing.trackId = null;
    });

    this.fade(incoming.el, target, CROSSFADE_MS, () => {
      this.crossfading = false;
    });
  }

  /** 音量を滑らかに動かす。 */
  private fade(
    el: HTMLAudioElement,
    to: number,
    durationMs: number,
    done?: () => void,
  ): void {
    const from = el.volume;
    const steps = Math.max(1, Math.round(durationMs / FADE_STEP_MS));
    let step = 0;

    const timer = setInterval(() => {
      step += 1;
      const ratio = Math.min(1, step / steps);
      el.volume = Math.min(1, Math.max(0, from + (to - from) * ratio));
      if (ratio >= 1) {
        clearInterval(timer);
        this.fadeTimers.delete(timer);
        done?.();
      }
    }, FADE_STEP_MS);

    this.fadeTimers.add(timer);
  }

  private releaseObjectUrl(deck: Deck): void {
    if (!deck.objectUrl) return;
    URL.revokeObjectURL(deck.objectUrl);
    deck.objectUrl = null;
  }

  /* ---------------- ロック画面・コントロールセンター ---------------- */

  private registerMediaSessionHandlers(): void {
    if (!("mediaSession" in navigator)) return;
    const session = navigator.mediaSession;

    session.setActionHandler("play", () => usePlayer.getState().toggle());
    session.setActionHandler("pause", () => usePlayer.getState().toggle());
    session.setActionHandler("previoustrack", () => usePlayer.getState().prev());
    session.setActionHandler("nexttrack", () => usePlayer.getState().next());
    session.setActionHandler("seekto", (details) => {
      if (details.seekTime !== undefined) usePlayer.getState().seek(details.seekTime * 1000);
    });
    session.setActionHandler("seekbackward", (details) => {
      const offset = (details.seekOffset ?? 10) * 1000;
      usePlayer.getState().seek(Math.max(0, usePlayer.getState().positionMs - offset));
    });
    session.setActionHandler("seekforward", (details) => {
      const offset = (details.seekOffset ?? 10) * 1000;
      usePlayer.getState().seek(usePlayer.getState().positionMs + offset);
    });
  }

  syncMediaSession(): void {
    if (!("mediaSession" in navigator)) return;
    const player = usePlayer.getState();
    const track = player.current();
    const artwork = artworkUrl(track?.artworkUrl);

    navigator.mediaSession.metadata = track
      ? new MediaMetadata({
          title: track.title,
          artist: track.artist,
          album: track.album ?? "",
          // ロック画面に出るジャケット。複数サイズを並べておくと OS 側が選べる。
          artwork: artwork
            ? [
                { src: artwork, sizes: "256x256", type: "image/jpeg" },
                { src: artwork, sizes: "512x512", type: "image/jpeg" },
              ]
            : [],
        })
      : null;

    navigator.mediaSession.playbackState = player.playing ? "playing" : "paused";
  }

  /** ロック画面のシークバーに現在地を反映する。 */
  private syncPositionState(): void {
    if (!("mediaSession" in navigator) || !navigator.mediaSession.setPositionState) return;
    const el = this.current.el;
    if (!Number.isFinite(el.duration) || el.duration <= 0) return;

    try {
      navigator.mediaSession.setPositionState({
        duration: el.duration,
        position: Math.min(el.currentTime, el.duration),
        playbackRate: el.playbackRate,
      });
    } catch {
      // 値の整合が取れない瞬間は無視してよい。次の更新で入り直す。
    }
  }
}

export const audioEngine = new AudioEngine();

/**
 * 一緒に聴いている場へ、この曲を出せるかどうかを伝える。
 *
 * 各自が別々に音源を用意する方式なので、誰か一人だけ揃わないことがある。
 * 黙っていると相手側でいつまでも待つことになるので、成否とも必ず伝える。
 * 参加していないときは何も起きない。
 */
function reportReadiness(trackId: string, ready: boolean, reason?: string): void {
  const session = useSession.getState();
  if (!session.inSession) return;
  session.reportReadiness(trackId, ready, reason);
}

function describeMediaError(error: MediaError | null): string {
  switch (error?.code) {
    case MediaError.MEDIA_ERR_ABORTED:
      return "再生が中断されました。";
    case MediaError.MEDIA_ERR_NETWORK:
      return "自分の PC に接続できませんでした。起動しているか確認してください。";
    case MediaError.MEDIA_ERR_DECODE:
      return "音声を再生できませんでした（形式が未対応の可能性があります）。";
    case MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED:
      return "この曲を取得できませんでした。";
    default:
      return "再生できませんでした。";
  }
}

function describePlayRejection(error: unknown): string {
  if (error instanceof DOMException && error.name === "NotAllowedError") {
    return "再生が許可されませんでした。画面をタップしてからもう一度お試しください。";
  }
  return "再生を開始できませんでした。";
}
