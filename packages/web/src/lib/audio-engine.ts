import type { Track } from "@musicshare/shared";
import { attachBackend, usePlayer } from "./player-store.js";
import {
  artworkUrl,
  canStreamDirectly,
  fetchTrackObjectUrl,
  streamUrl,
} from "./node-client.js";

/**
 * 実際の再生を担う層。
 *
 * iOS を主対象に置いた都合で、守っている約束がいくつかある。
 *
 *   1. audio 要素はアプリを通して 1 つだけ作り、使い回す。
 *      曲ごとに作り直すと、最初の操作で得た再生許可を失って以降鳴らなくなる。
 *   2. 曲を切り替えるとき、URL の解決を待たない。
 *      待つと操作から時間が空き、その間に再生許可が切れる。
 *      trackId だけで開ける URL を用意してあるので、そのまま src に入れる。
 *   3. 最初のユーザー操作で無音を一度鳴らして許可を得ておく。
 */

/** 0.05 秒の無音 WAV。再生許可を取るためだけに使う。 */
const SILENCE =
  "data:audio/wav;base64,UklGRkQDAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YSADAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==";

class AudioEngine {
  private el: HTMLAudioElement | null = null;
  private loadedTrackId: string | null = null;
  private unlocked = false;
  /** 許可取得中。この間の失敗は曲の再生失敗ではないので、表に出さない。 */
  private unlocking = false;
  /** 再生許可を取る前に play を頼まれた場合に、許可が取れ次第再生する。 */
  private playWhenUnlocked = false;
  /** 直結で受け取った音声。差し替えるときに解放する。 */
  private objectUrl: string | null = null;

  init(): void {
    if (this.el) return;

    const el = document.createElement("audio");
    el.preload = "auto";
    // 音源は同一オリジン (node への中継) 経由でしか来ないので crossOrigin は付けない。
    // 付けると CORS 前提の取得になり、かえって失敗する。
    // インライン再生を明示しないと、全画面のネイティブプレーヤーに奪われる。
    el.setAttribute("playsinline", "");
    el.setAttribute("webkit-playsinline", "");
    el.style.display = "none";
    document.body.appendChild(el);
    this.el = el;

    el.addEventListener("timeupdate", () => {
      usePlayer.getState().reportPosition(el.currentTime * 1000);
      this.syncPositionState();
    });

    el.addEventListener("loadedmetadata", () => {
      if (Number.isFinite(el.duration)) {
        usePlayer.getState().reportDuration(el.duration * 1000);
      }
      this.syncPositionState();
    });

    el.addEventListener("playing", () => {
      const player = usePlayer.getState();
      player.reportPlaying(true);
      player.reportLoading(false);
      player.reportError(null);
      this.syncMediaSession();
    });

    el.addEventListener("pause", () => {
      usePlayer.getState().reportPlaying(false);
      this.syncMediaSession();
    });

    el.addEventListener("waiting", () => usePlayer.getState().reportLoading(true));
    el.addEventListener("canplay", () => usePlayer.getState().reportLoading(false));

    el.addEventListener("ended", () => usePlayer.getState().handleEnded());

    el.addEventListener("error", () => {
      // 許可取得のための無音再生で転んでも、利用者には関係ない。
      if (this.unlocking) return;
      usePlayer.getState().reportError(describeMediaError(el.error));
      usePlayer.getState().reportPlaying(false);
    });

    attachBackend({
      play: () => this.play(),
      pause: () => this.pause(),
      seek: (positionMs) => this.seek(positionMs),
      setVolume: (volume, muted) => this.setVolume(volume, muted),
    });

    this.registerMediaSessionHandlers();
  }

  /**
   * 最初のユーザー操作から呼ぶ。
   * 無音を一瞬鳴らして再生許可を得ておくと、以降は操作から離れた文脈でも鳴らせる。
   */
  unlock(): void {
    if (this.unlocked || this.unlocking || !this.el) return;
    const el = this.el;

    // まだ曲を読み込んでいないときだけ無音を挟む。
    // 再生中の曲がある状態で src を書き換えると、その再生を殺してしまう。
    if (this.loadedTrackId !== null) {
      this.unlocked = true;
      return;
    }

    this.unlocking = true;
    const restoreVolume = () => {
      const player = usePlayer.getState();
      el.volume = player.muted ? 0 : player.volume;
    };

    el.src = SILENCE;
    el.volume = 0;

    void el
      .play()
      .then(() => {
        el.pause();
        el.currentTime = 0;
        this.unlocked = true;
      })
      .catch(() => {
        // 失敗しても致命ではない。次のユーザー操作でまた試す。
      })
      .finally(() => {
        this.unlocking = false;
        restoreVolume();
        if (this.playWhenUnlocked) {
          this.playWhenUnlocked = false;
          this.play();
        }
      });
  }

  private play(): void {
    const el = this.el;
    if (!el) return;

    const player = usePlayer.getState();
    const track = player.current();
    if (!track) return;

    if (!this.unlocked) {
      this.playWhenUnlocked = true;
      this.unlock();
      return;
    }

    // 曲が変わったときだけ読み込み直す。同じ曲なら位置を保ったまま再開する。
    if (this.loadedTrackId !== track.id) {
      void this.loadTrack(track);
      return;
    }

    this.startPlayback();
  }

  private async loadTrack(track: Track): Promise<void> {
    const el = this.el;
    if (!el) return;

    this.loadedTrackId = track.id;
    usePlayer.getState().reportDuration(0);
    usePlayer.getState().reportLoading(true);
    this.syncMediaSession();

    this.releaseObjectUrl();

    try {
      if (canStreamDirectly()) {
        // 中継経路では URL をそのまま渡せる。解決を待たないので頭出しが速い。
        el.src = streamUrl(track.id);
      } else {
        // 直結では一度受け取りきる。待つあいだに曲が変わっていたら捨てる。
        const url = await fetchTrackObjectUrl(track.id);
        if (this.loadedTrackId !== track.id) {
          URL.revokeObjectURL(url);
          return;
        }
        this.objectUrl = url;
        el.src = url;
      }

      el.load();
      this.startPlayback();
    } catch (error) {
      usePlayer
        .getState()
        .reportError(error instanceof Error ? error.message : "曲を取得できませんでした。");
      usePlayer.getState().reportPlaying(false);
    }
  }

  private startPlayback(): void {
    const el = this.el;
    if (!el) return;

    const player = usePlayer.getState();
    el.volume = player.muted ? 0 : player.volume;
    player.reportLoading(true);

    void el.play().catch((error: unknown) => {
      usePlayer.getState().reportError(describePlayRejection(error));
      usePlayer.getState().reportPlaying(false);
    });

    this.syncMediaSession();
  }

  /** 受け取りきった音声の後始末。放っておくと端末の記憶を食い続ける。 */
  private releaseObjectUrl(): void {
    if (!this.objectUrl) return;
    URL.revokeObjectURL(this.objectUrl);
    this.objectUrl = null;
  }

  private pause(): void {
    this.el?.pause();
  }

  private seek(positionMs: number): void {
    const el = this.el;
    if (!el) return;
    // メタデータ未取得のうちは currentTime を受け付けないので、読めてから当てる。
    if (el.readyState === 0) {
      el.addEventListener("loadedmetadata", () => {
        el.currentTime = positionMs / 1000;
      }, { once: true });
      return;
    }
    el.currentTime = positionMs / 1000;
    this.syncPositionState();
  }

  private setVolume(volume: number, muted: boolean): void {
    if (!this.el) return;
    this.el.volume = muted ? 0 : volume;
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
    const el = this.el;
    if (!el || !Number.isFinite(el.duration) || el.duration <= 0) return;

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
