import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import type {
  FollowedArtist,
  Group,
  GroupMember,
  Playlist,
  Track,
  User,
} from "@musicshare/shared";

/**
 * 素朴な JSON ファイル永続化。
 *
 * ここに置いてよいのは識別子とメタデータだけ。音声は一切保持しない。
 * V1 では規模が小さいのでファイルで十分。増えたら SQLite に差し替える。
 */

interface Snapshot {
  users: User[];
  groups: Group[];
  playlists: Playlist[];
  tokens: Record<string, string>;
  /** 利用者ごとの、気に入ったアーティスト。 */
  follows: Record<string, FollowedArtist[]>;
}

const DATA_PATH = resolve(process.cwd(), "data", "hub.json");

const empty: Snapshot = { users: [], groups: [], playlists: [], tokens: {}, follows: {} };

let snapshot: Snapshot = structuredClone(empty);
let writeQueue: Promise<void> = Promise.resolve();

/** 紛らわしい文字を外した英数字。口頭で伝えても取り違えない。 */
const CODE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";

function makeCode(length = 6): string {
  const bytes = randomBytes(length);
  let code = "";
  for (let i = 0; i < length; i += 1) code += CODE_ALPHABET[bytes[i]! % CODE_ALPHABET.length];
  return code;
}

export async function loadStore(): Promise<void> {
  try {
    const raw = await readFile(DATA_PATH, "utf8");
    snapshot = { ...structuredClone(empty), ...(JSON.parse(raw) as Snapshot) };
  } catch {
    snapshot = structuredClone(empty);
  }
}

function persist(): void {
  // 書き込みを直列化して、同時更新で壊れないようにする。
  writeQueue = writeQueue.then(async () => {
    await mkdir(dirname(DATA_PATH), { recursive: true });
    await writeFile(DATA_PATH, JSON.stringify(snapshot, null, 2), "utf8");
  });
}

/* -------------------------------- 利用者 -------------------------------- */

export function createUser(displayName: string): { user: User; token: string } {
  const user: User = { id: randomUUID(), displayName };
  const token = randomUUID();
  snapshot.users.push(user);
  snapshot.tokens[token] = user.id;
  persist();
  return { user, token };
}

export function userForToken(token: string | undefined): User | undefined {
  if (!token) return undefined;
  const userId = snapshot.tokens[token];
  if (!userId) return undefined;
  return snapshot.users.find((u) => u.id === userId);
}

export function getUser(id: string): User | undefined {
  return snapshot.users.find((u) => u.id === id);
}

export function renameUser(id: string, displayName: string): User | undefined {
  const user = getUser(id);
  if (!user) return undefined;
  user.displayName = displayName;
  persist();
  return user;
}

/* ------------------------------- グループ ------------------------------- */

export function groupsForUser(userId: string): Group[] {
  return snapshot.groups.filter((g) => g.memberIds.includes(userId));
}

export function createGroup(name: string, ownerId: string): Group {
  const group: Group = {
    id: randomUUID(),
    name,
    ownerId,
    memberIds: [ownerId],
    inviteCode: makeCode(),
    createdAt: new Date().toISOString(),
  };
  snapshot.groups.push(group);
  persist();
  return group;
}

export function getGroup(id: string): Group | undefined {
  return snapshot.groups.find((g) => g.id === id);
}

/** 合言葉で参加する。識別子を直接渡すより誘いやすい。 */
export function joinGroupByCode(code: string, userId: string): Group | undefined {
  const group = snapshot.groups.find((g) => g.inviteCode === code.trim().toUpperCase());
  if (!group) return undefined;
  if (!group.memberIds.includes(userId)) {
    group.memberIds.push(userId);
    persist();
  }
  return group;
}

export function leaveGroup(groupId: string, userId: string): boolean {
  const group = getGroup(groupId);
  if (!group) return false;

  group.memberIds = group.memberIds.filter((id) => id !== userId);

  // 誰もいなくなった集まりは、そこにあった共有プレイリストごと片付ける。
  if (group.memberIds.length === 0) {
    snapshot.groups = snapshot.groups.filter((g) => g.id !== groupId);
    snapshot.playlists = snapshot.playlists.filter((p) => p.groupId !== groupId);
  } else if (group.ownerId === userId) {
    group.ownerId = group.memberIds[0]!;
  }

  persist();
  return true;
}

/** 表示用にメンバーの名前を添える。 */
export function membersOf(group: Group): GroupMember[] {
  return group.memberIds.map((id) => ({
    id,
    displayName: getUser(id)?.displayName ?? "不明",
  }));
}

/* ------------------------------ プレイリスト ------------------------------ */

export function playlistsForUser(userId: string): Playlist[] {
  const groupIds = new Set(groupsForUser(userId).map((g) => g.id));
  return snapshot.playlists.filter(
    (p) => p.ownerId === userId || (p.groupId !== undefined && groupIds.has(p.groupId)),
  );
}

export function createPlaylist(input: {
  name: string;
  ownerId: string;
  groupId?: string;
  description?: string;
}): Playlist {
  const now = new Date().toISOString();
  const playlist: Playlist = {
    id: randomUUID(),
    name: input.name,
    description: input.description,
    ownerId: input.ownerId,
    groupId: input.groupId,
    tracks: [],
    createdAt: now,
    updatedAt: now,
  };
  snapshot.playlists.push(playlist);
  persist();
  return playlist;
}

export function getPlaylist(id: string): Playlist | undefined {
  return snapshot.playlists.find((p) => p.id === id);
}

/** 見える相手かどうか。共有プレイリストは同じ集まりの人なら触れる。 */
export function canAccessPlaylist(playlist: Playlist, userId: string): boolean {
  if (playlist.ownerId === userId) return true;
  if (!playlist.groupId) return false;
  return getGroup(playlist.groupId)?.memberIds.includes(userId) ?? false;
}

export function setPlaylistTracks(id: string, tracks: Track[]): Playlist | undefined {
  const playlist = getPlaylist(id);
  if (!playlist) return undefined;
  playlist.tracks = tracks;
  playlist.updatedAt = new Date().toISOString();
  persist();
  return playlist;
}

export function addTrackToPlaylist(id: string, track: Track): Playlist | undefined {
  const playlist = getPlaylist(id);
  if (!playlist) return undefined;
  // 同じ曲を二度入れない。共有だと誰かが既に足していることがある。
  if (!playlist.tracks.some((t) => t.id === track.id)) {
    playlist.tracks.push(track);
    playlist.updatedAt = new Date().toISOString();
    persist();
  }
  return playlist;
}

export function removeTrackFromPlaylist(id: string, trackId: string): Playlist | undefined {
  const playlist = getPlaylist(id);
  if (!playlist) return undefined;
  playlist.tracks = playlist.tracks.filter((t) => t.id !== trackId);
  playlist.updatedAt = new Date().toISOString();
  persist();
  return playlist;
}

/* ------------------------------ フォロー ------------------------------ */

export function followsFor(userId: string): FollowedArtist[] {
  return snapshot.follows[userId] ?? [];
}

export function followArtist(
  userId: string,
  artist: { id: string; name: string; artworkUrl?: string },
): FollowedArtist[] {
  const list = followsFor(userId);
  if (!list.some((a) => a.id === artist.id)) {
    // 新しいものを先に。よく開くのはたいてい直近のもの。
    snapshot.follows[userId] = [
      { ...artist, followedAt: new Date().toISOString() },
      ...list,
    ];
    persist();
  }
  return followsFor(userId);
}

export function unfollowArtist(userId: string, artistId: string): FollowedArtist[] {
  snapshot.follows[userId] = followsFor(userId).filter((a) => a.id !== artistId);
  persist();
  return followsFor(userId);
}

export function deletePlaylist(id: string): boolean {
  const before = snapshot.playlists.length;
  snapshot.playlists = snapshot.playlists.filter((p) => p.id !== id);
  const removed = snapshot.playlists.length !== before;
  if (removed) persist();
  return removed;
}
