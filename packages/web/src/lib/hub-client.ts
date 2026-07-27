import type {
  FollowedArtist,
  GroupWithMembers,
  LikedTrack,
  LoginResponse,
  MeResponse,
  Playlist,
  Track,
  User,
} from "@musicshare/shared";

/**
 * 中央サーバーとのやり取り。
 *
 * ここを流れるのは識別子とメタデータだけ。音声は通らない。
 * 曲の実体は各自の PC から取るので、この層は名前と並びの管理に徹する。
 */

const BASE = import.meta.env["VITE_HUB_BASE"] ?? "/hub-api";
const TOKEN_KEY = "musicshare.hub-token";

export function storedToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

function setToken(token: string | null): void {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

async function call<T>(
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<T> {
  const token = storedToken();
  const response = await fetch(`${BASE}${path}`, {
    method: init.method ?? "GET",
    headers: {
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: init.body ? JSON.stringify(init.body) : undefined,
  });

  if (response.status === 401) {
    // 期限切れや作り直しで通らなくなった控えは捨てる。
    setToken(null);
    throw new Error("もう一度サインインしてください。");
  }
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `通信に失敗しました (${response.status})`);
  }
  return (await response.json()) as T;
}

export async function hubLogin(displayName: string): Promise<User> {
  const result = await call<LoginResponse>("/api/auth/login", {
    method: "POST",
    body: { displayName },
  });
  setToken(result.token);
  return result.user;
}

export function hubSignOut(): void {
  setToken(null);
}

export function hubMe(): Promise<MeResponse> {
  return call<MeResponse>("/api/me");
}

export function hubRename(displayName: string): Promise<User> {
  return call<User>("/api/me", { method: "PATCH", body: { displayName } });
}

/* ------------------------------- グループ ------------------------------- */

export function hubCreateGroup(name: string): Promise<GroupWithMembers> {
  return call<GroupWithMembers>("/api/groups", { method: "POST", body: { name } });
}

export function hubJoinGroup(code: string): Promise<GroupWithMembers> {
  return call<GroupWithMembers>("/api/groups/join", { method: "POST", body: { code } });
}

export function hubLeaveGroup(groupId: string): Promise<{ ok: boolean }> {
  return call<{ ok: boolean }>(`/api/groups/${groupId}/leave`, { method: "POST" });
}

/* ------------------------------ プレイリスト ------------------------------ */

export function hubCreatePlaylist(input: {
  name: string;
  groupId?: string;
  description?: string;
}): Promise<Playlist> {
  return call<Playlist>("/api/playlists", { method: "POST", body: input });
}

export function hubSetTracks(playlistId: string, tracks: Track[]): Promise<Playlist> {
  return call<Playlist>(`/api/playlists/${playlistId}/tracks`, {
    method: "PUT",
    body: { tracks },
  });
}

export function hubAddTrack(playlistId: string, track: Track): Promise<Playlist> {
  return call<Playlist>(`/api/playlists/${playlistId}/tracks`, {
    method: "POST",
    body: { track },
  });
}

export function hubRemoveTrack(playlistId: string, trackId: string): Promise<Playlist> {
  return call<Playlist>(`/api/playlists/${playlistId}/tracks/${trackId}`, { method: "DELETE" });
}

export function hubDeletePlaylist(playlistId: string): Promise<{ ok: boolean }> {
  return call<{ ok: boolean }>(`/api/playlists/${playlistId}`, { method: "DELETE" });
}

/* ------------------------------ フォロー ------------------------------ */

export function hubFollow(artist: {
  id: string;
  name: string;
  artworkUrl?: string;
}): Promise<FollowedArtist[]> {
  return call<FollowedArtist[]>("/api/follows", { method: "POST", body: artist });
}

export function hubUnfollow(artistId: string): Promise<FollowedArtist[]> {
  return call<FollowedArtist[]>(`/api/follows/${encodeURIComponent(artistId)}`, {
    method: "DELETE",
  });
}

/* ------------------------------ 気に入った曲 ------------------------------ */

export function hubLike(track: Track): Promise<LikedTrack[]> {
  return call<LikedTrack[]>("/api/likes", { method: "POST", body: { track } });
}

export function hubUnlike(trackId: string): Promise<LikedTrack[]> {
  return call<LikedTrack[]>(`/api/likes/${encodeURIComponent(trackId)}`, { method: "DELETE" });
}

/* ------------------------------ 同時リスニング ------------------------------ */

export function hubCreateSession(groupId: string): Promise<{ id: string }> {
  return call<{ id: string }>("/api/sessions", { method: "POST", body: { groupId } });
}

export function hubListSessions(): Promise<{ id: string; groupId: string; hostId: string }[]> {
  return call<{ id: string; groupId: string; hostId: string }[]>("/api/sessions");
}
