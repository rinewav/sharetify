import { create } from "zustand";
import type { GroupWithMembers, Playlist, Track, User } from "@musicshare/shared";
import {
  hubAddTrack,
  hubCreateGroup,
  hubCreatePlaylist,
  hubDeletePlaylist,
  hubJoinGroup,
  hubLeaveGroup,
  hubLogin,
  hubMe,
  hubRemoveTrack,
  hubSetTracks,
  hubSignOut,
  storedToken,
} from "./hub-client.js";

/**
 * 手元の書棚。
 *
 * 中央サーバーが持っているのと同じものを写しておき、
 * 画面はこちらだけを見る。書き換えたら控えを取り直す。
 */

interface LibraryState {
  user: User | null;
  groups: GroupWithMembers[];
  playlists: Playlist[];
  loading: boolean;
  error: string | null;
  /** 中央サーバーに繋がっているか。落ちていても再生は続けられる。 */
  online: boolean;

  refresh: () => Promise<void>;
  signIn: (displayName: string) => Promise<void>;
  signOut: () => void;

  createGroup: (name: string) => Promise<void>;
  joinGroup: (code: string) => Promise<void>;
  leaveGroup: (groupId: string) => Promise<void>;

  createPlaylist: (input: { name: string; groupId?: string }) => Promise<Playlist | null>;
  addTrack: (playlistId: string, track: Track) => Promise<void>;
  removeTrack: (playlistId: string, trackId: string) => Promise<void>;
  reorderTracks: (playlistId: string, tracks: Track[]) => Promise<void>;
  deletePlaylist: (playlistId: string) => Promise<void>;

  playlistById: (id: string) => Playlist | undefined;
  groupById: (id: string) => GroupWithMembers | undefined;
}

export const useLibrary = create<LibraryState>((set, get) => ({
  user: null,
  groups: [],
  playlists: [],
  loading: false,
  error: null,
  online: false,

  refresh: async () => {
    if (!storedToken()) {
      set({ user: null, groups: [], playlists: [], online: false });
      return;
    }
    set({ loading: true });
    try {
      const me = await hubMe();
      set({
        user: me.user,
        groups: me.groups,
        playlists: me.playlists,
        online: true,
        error: null,
      });
    } catch (error) {
      set({
        online: false,
        error: error instanceof Error ? error.message : "読み込みに失敗しました。",
        // 認証が切れていた場合は入り直してもらう。
        user: storedToken() ? get().user : null,
      });
    } finally {
      set({ loading: false });
    }
  },

  signIn: async (displayName) => {
    set({ loading: true, error: null });
    try {
      const user = await hubLogin(displayName);
      set({ user, online: true });
      await get().refresh();
    } catch (error) {
      set({ error: error instanceof Error ? error.message : "サインインに失敗しました。" });
    } finally {
      set({ loading: false });
    }
  },

  signOut: () => {
    hubSignOut();
    set({ user: null, groups: [], playlists: [], online: false });
  },

  createGroup: async (name) => {
    await guard(set, async () => {
      await hubCreateGroup(name);
      await get().refresh();
    });
  },

  joinGroup: async (code) => {
    await guard(set, async () => {
      await hubJoinGroup(code);
      await get().refresh();
    });
  },

  leaveGroup: async (groupId) => {
    await guard(set, async () => {
      await hubLeaveGroup(groupId);
      await get().refresh();
    });
  },

  createPlaylist: async (input) => {
    let created: Playlist | null = null;
    await guard(set, async () => {
      created = await hubCreatePlaylist(input);
      await get().refresh();
    });
    return created;
  },

  addTrack: async (playlistId, track) => {
    await guard(set, async () => {
      const updated = await hubAddTrack(playlistId, track);
      replacePlaylist(set, get, updated);
    });
  },

  removeTrack: async (playlistId, trackId) => {
    await guard(set, async () => {
      const updated = await hubRemoveTrack(playlistId, trackId);
      replacePlaylist(set, get, updated);
    });
  },

  reorderTracks: async (playlistId, tracks) => {
    // 並べ替えは見た目を先に動かす。待たされると掴んだ感じが途切れる。
    replacePlaylist(set, get, { ...get().playlistById(playlistId)!, tracks });
    await guard(set, async () => {
      const updated = await hubSetTracks(playlistId, tracks);
      replacePlaylist(set, get, updated);
    });
  },

  deletePlaylist: async (playlistId) => {
    await guard(set, async () => {
      await hubDeletePlaylist(playlistId);
      await get().refresh();
    });
  },

  playlistById: (id) => get().playlists.find((p) => p.id === id),
  groupById: (id) => get().groups.find((g) => g.id === id),
}));

type Setter = (partial: Partial<LibraryState>) => void;

/** 失敗しても画面を壊さない。理由だけ表に出す。 */
async function guard(set: Setter, action: () => Promise<void>): Promise<void> {
  try {
    set({ error: null });
    await action();
  } catch (error) {
    set({ error: error instanceof Error ? error.message : "操作に失敗しました。" });
  }
}

function replacePlaylist(
  set: Setter,
  get: () => LibraryState,
  playlist: Playlist | undefined,
): void {
  if (!playlist) return;
  set({ playlists: get().playlists.map((p) => (p.id === playlist.id ? playlist : p)) });
}
