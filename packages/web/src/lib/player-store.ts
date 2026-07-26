import { create } from "zustand";
import type { Track } from "@musicshare/shared";

/**
 * 再生状態。
 *
 * 仮組みの段階では音声を実際には鳴らさず、タイマーで再生位置だけを進める。
 * 実装が進んだら `audioUrl` に node が返すローカル URL を差し込み、
 * tick を audio 要素の timeupdate に置き換える。構造はそのまま使える。
 */

export type RepeatMode = "off" | "all" | "one";

interface PlayerState {
  queue: Track[];
  index: number;
  playing: boolean;
  positionMs: number;
  volume: number;
  muted: boolean;
  shuffle: boolean;
  repeat: RepeatMode;
  /** 一緒に聴いているセッションに参加している間は true。ホスト以外は操作が効かない。 */
  followingSession: boolean;
  isSessionHost: boolean;

  current: () => Track | undefined;
  durationMs: () => number;

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
  tick: (deltaMs: number) => void;
  /** hub から届いた再生位置に合わせる。同時リスニング用。 */
  applyRemotePosition: (positionMs: number) => void;
  setSessionRole: (following: boolean, isHost: boolean) => void;
}

export const usePlayer = create<PlayerState>((set, get) => ({
  queue: [],
  index: 0,
  playing: false,
  positionMs: 0,
  volume: 0.8,
  muted: false,
  shuffle: false,
  repeat: "off",
  followingSession: false,
  isSessionHost: false,

  current: () => get().queue[get().index],
  durationMs: () => get().current()?.durationMs ?? 0,

  playQueue: (tracks, startIndex) => {
    if (tracks.length === 0) return;
    const index = Math.min(Math.max(0, startIndex), tracks.length - 1);
    set({ queue: tracks, index, positionMs: 0, playing: true });
  },

  playTrack: (track) => {
    const { queue } = get();
    const existing = queue.findIndex((t) => t.id === track.id);
    if (existing >= 0) {
      set({ index: existing, positionMs: 0, playing: true });
      return;
    }
    set({ queue: [...queue, track], index: queue.length, positionMs: 0, playing: true });
  },

  toggle: () => set((s) => ({ playing: !s.playing })),

  next: () => {
    const { queue, index, repeat } = get();
    if (queue.length === 0) return;

    if (repeat === "one") {
      set({ positionMs: 0, playing: true });
      return;
    }
    const nextIndex = index + 1;
    if (nextIndex >= queue.length) {
      // 末尾に来たら、リピートしない限り止める。勝手に頭へ戻さない。
      if (repeat === "all") set({ index: 0, positionMs: 0, playing: true });
      else set({ playing: false, positionMs: 0 });
      return;
    }
    set({ index: nextIndex, positionMs: 0, playing: true });
  },

  prev: () => {
    const { index, positionMs } = get();
    // 3 秒以上進んでいたら曲を戻さず頭出しにする。よくある挙動に合わせる。
    if (positionMs > 3000 || index === 0) {
      set({ positionMs: 0 });
      return;
    }
    set({ index: index - 1, positionMs: 0 });
  },

  seek: (positionMs) => set({ positionMs: Math.max(0, positionMs) }),

  setVolume: (volume) => set({ volume: Math.min(1, Math.max(0, volume)), muted: false }),

  toggleMute: () => set((s) => ({ muted: !s.muted })),

  toggleShuffle: () => set((s) => ({ shuffle: !s.shuffle })),

  cycleRepeat: () =>
    set((s) => ({
      repeat: s.repeat === "off" ? "all" : s.repeat === "all" ? "one" : "off",
    })),

  tick: (deltaMs) => {
    const { playing, positionMs, current, next } = get();
    if (!playing) return;
    const duration = current()?.durationMs ?? 0;
    const nextPosition = positionMs + deltaMs;
    if (duration > 0 && nextPosition >= duration) {
      next();
      return;
    }
    set({ positionMs: nextPosition });
  },

  applyRemotePosition: (positionMs) => set({ positionMs: Math.max(0, positionMs) }),

  setSessionRole: (followingSession, isSessionHost) => set({ followingSession, isSessionHost }),
}));

/** ホストでないのにセッションに参加している間は、再生操作を握らせない。 */
export function canControl(state: {
  followingSession: boolean;
  isSessionHost: boolean;
}): boolean {
  return !state.followingSession || state.isSessionHost;
}
