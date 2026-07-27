import { create } from "zustand";
import type { Track } from "@musicshare/shared";

/**
 * 再生状態。
 *
 * 実際の再生は audio-engine が持つ単一の audio 要素が担う。
 * このストアはその状態を映すのと、操作の入口を用意するのが役目。
 * 位置や再生中かどうかを直接書き換えるのは engine 側だけにして、
 * 二重管理でズレないようにしている。
 */

export type RepeatMode = "off" | "all" | "one";

/** engine が実装する操作。循環参照を避けるため、後から差し込む。 */
export interface PlaybackBackend {
  play: () => void;
  pause: () => void;
  seek: (positionMs: number) => void;
  setVolume: (volume: number, muted: boolean) => void;
}

let backend: PlaybackBackend | null = null;

export function attachBackend(next: PlaybackBackend): void {
  backend = next;
}

interface PlayerState {
  queue: Track[];
  index: number;
  playing: boolean;
  positionMs: number;
  /** audio 側から取れた実際の長さ。取れるまでは track の値で代用する。 */
  loadedDurationMs: number;
  volume: number;
  muted: boolean;
  shuffle: boolean;
  /** かき混ぜる前の並び。解除したときに戻すために持つ。 */
  orderedQueue: Track[] | null;
  repeat: RepeatMode;
  /** 取得中。頭出しまでの待ちを UI に出すために持つ。 */
  loading: boolean;
  /** 取得に失敗した理由。黙って無音にしないための表示用。 */
  error: string | null;
  followingSession: boolean;
  isSessionHost: boolean;

  current: () => Track | undefined;
  durationMs: () => number;
  /** 次に来る曲。順番を進めずに覗くだけ。繋ぎの先読みに使う。 */
  peekNext: () => Track | undefined;
  /** 繋ぎ終わったあとに順番だけ進める。再生の指示は出さない。 */
  advanceToNext: () => void;

  playQueue: (tracks: Track[], startIndex: number) => void;
  playTrack: (track: Track) => void;
  toggle: () => void;
  next: () => void;
  prev: () => void;
  seek: (positionMs: number) => void;
  setVolume: (volume: number) => void;
  toggleMute: () => void;
  toggleShuffle: () => void;
  cycleRepeat: () => void;

  /* engine から呼ばれる。UI からは触らない。 */
  reportPosition: (positionMs: number) => void;
  reportDuration: (durationMs: number) => void;
  reportPlaying: (playing: boolean) => void;
  reportLoading: (loading: boolean) => void;
  reportError: (error: string | null) => void;
  handleEnded: () => void;

  applyRemotePosition: (positionMs: number) => void;
  setSessionRole: (following: boolean, isHost: boolean) => void;
}

export const usePlayer = create<PlayerState>((set, get) => ({
  queue: [],
  index: 0,
  playing: false,
  positionMs: 0,
  loadedDurationMs: 0,
  volume: 0.8,
  muted: false,
  shuffle: false,
  orderedQueue: null,
  repeat: "off",
  loading: false,
  error: null,
  followingSession: false,
  isSessionHost: false,

  current: () => get().queue[get().index],

  /*
   * 長さはカタログの値を先に信じる。
   *
   * 音声ファイルから読める長さは、末尾に無音が続く素材だと実際の曲より長く出る。
   * カタログ側は曲としての長さを持っているので、そちらのほうが表示に適している。
   * 持っていない場合だけ、読み込んだ音声の値で代用する。
   */
  durationMs: () => {
    const declared = get().current()?.durationMs;
    if (declared && declared > 0) return declared;
    return get().loadedDurationMs;
  },

  peekNext: () => {
    const { queue, index, repeat } = get();
    if (queue.length === 0) return undefined;
    const nextIndex = index + 1;
    if (nextIndex < queue.length) return queue[nextIndex];
    return repeat === "all" ? queue[0] : undefined;
  },

  advanceToNext: () => {
    const { queue, index, repeat } = get();
    const nextIndex = index + 1;
    if (nextIndex < queue.length) {
      set({ index: nextIndex, positionMs: 0, loadedDurationMs: 0, error: null });
    } else if (repeat === "all") {
      set({ index: 0, positionMs: 0, loadedDurationMs: 0, error: null });
    }
  },

  playQueue: (tracks, startIndex) => {
    if (tracks.length === 0) return;
    const index = Math.min(Math.max(0, startIndex), tracks.length - 1);
    // 新しい並びを入れたら、かき混ぜる前の控えは意味を失う。
    set({
      queue: tracks,
      index,
      positionMs: 0,
      loadedDurationMs: 0,
      error: null,
      orderedQueue: null,
      shuffle: false,
    });
    backend?.play();
  },

  playTrack: (track) => {
    const { queue } = get();
    const existing = queue.findIndex((t) => t.id === track.id);
    if (existing >= 0) {
      set({ index: existing, positionMs: 0, loadedDurationMs: 0, error: null });
    } else {
      set({
        queue: [...queue, track],
        index: queue.length,
        positionMs: 0,
        loadedDurationMs: 0,
        error: null,
      });
    }
    backend?.play();
  },

  toggle: () => {
    if (get().playing) backend?.pause();
    else backend?.play();
  },

  next: () => {
    const { queue, index, repeat } = get();
    if (queue.length === 0) return;

    if (repeat === "one") {
      set({ positionMs: 0 });
      backend?.seek(0);
      backend?.play();
      return;
    }

    const nextIndex = index + 1;
    if (nextIndex >= queue.length) {
      // 末尾ではリピート指定がない限り止める。勝手に頭へ戻さない。
      if (repeat === "all") {
        set({ index: 0, positionMs: 0, loadedDurationMs: 0, error: null });
        backend?.play();
      } else {
        set({ positionMs: 0 });
        backend?.pause();
      }
      return;
    }
    set({ index: nextIndex, positionMs: 0, loadedDurationMs: 0, error: null });
    backend?.play();
  },

  prev: () => {
    const { index, positionMs } = get();
    // 3 秒以上進んでいたら曲を戻さず頭出しにする。よくある挙動に合わせる。
    if (positionMs > 3000 || index === 0) {
      set({ positionMs: 0 });
      backend?.seek(0);
      return;
    }
    set({ index: index - 1, positionMs: 0, loadedDurationMs: 0, error: null });
    backend?.play();
  },

  seek: (positionMs) => {
    const next = Math.max(0, positionMs);
    set({ positionMs: next });
    backend?.seek(next);
  },

  setVolume: (volume) => {
    const next = Math.min(1, Math.max(0, volume));
    set({ volume: next, muted: false });
    backend?.setVolume(next, false);
  },

  toggleMute: () => {
    const muted = !get().muted;
    set({ muted });
    backend?.setVolume(get().volume, muted);
  },

  /**
   * 並びをかき混ぜる。
   *
   * 押した時点で残りの順番を変え、いま鳴っている曲は先頭に置く。
   * 解除したときに元へ戻せるよう、変える前の並びを控えておく。
   */
  toggleShuffle: () => {
    const { shuffle, queue, index, orderedQueue } = get();

    if (shuffle) {
      const restored = orderedQueue ?? queue;
      const playing = queue[index];
      const restoredIndex = playing ? restored.findIndex((t) => t.id === playing.id) : 0;
      set({
        shuffle: false,
        queue: restored,
        index: restoredIndex >= 0 ? restoredIndex : 0,
        orderedQueue: null,
      });
      return;
    }

    const playing = queue[index];
    const rest = queue.filter((_, i) => i !== index);
    const mixed = playing ? [playing, ...shuffleArray(rest)] : shuffleArray(rest);
    set({ shuffle: true, orderedQueue: queue, queue: mixed, index: 0 });
  },

  cycleRepeat: () =>
    set((s) => ({
      repeat: s.repeat === "off" ? "all" : s.repeat === "all" ? "one" : "off",
    })),

  reportPosition: (positionMs) => set({ positionMs }),
  reportDuration: (loadedDurationMs) => set({ loadedDurationMs }),
  reportPlaying: (playing) => set({ playing }),
  reportLoading: (loading) => set({ loading }),
  reportError: (error) => set({ error, loading: false }),

  handleEnded: () => get().next(),

  applyRemotePosition: (positionMs) => {
    set({ positionMs: Math.max(0, positionMs) });
    backend?.seek(positionMs);
  },

  setSessionRole: (followingSession, isSessionHost) => set({ followingSession, isSessionHost }),
}));

/** 並べ替えた写しを返す。元の配列には触らない。 */
function shuffleArray<T>(items: T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j]!, copy[i]!];
  }
  return copy;
}

/** ホストでないのにセッションに参加している間は、再生操作を握らせない。 */
export function canControl(state: {
  followingSession: boolean;
  isSessionHost: boolean;
}): boolean {
  return !state.followingSession || state.isSessionHost;
}
