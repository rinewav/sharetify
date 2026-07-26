import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import type { Group, Playlist, User } from "@musicshare/shared";

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
}

const DATA_PATH = resolve(process.cwd(), "data", "hub.json");

const empty: Snapshot = { users: [], groups: [], playlists: [], tokens: {} };

let snapshot: Snapshot = structuredClone(empty);
let writeQueue: Promise<void> = Promise.resolve();

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

export function groupsForUser(userId: string): Group[] {
  return snapshot.groups.filter((g) => g.memberIds.includes(userId));
}

export function createGroup(name: string, ownerId: string): Group {
  const group: Group = {
    id: randomUUID(),
    name,
    ownerId,
    memberIds: [ownerId],
    createdAt: new Date().toISOString(),
  };
  snapshot.groups.push(group);
  persist();
  return group;
}

export function getGroup(id: string): Group | undefined {
  return snapshot.groups.find((g) => g.id === id);
}

export function joinGroup(groupId: string, userId: string): Group | undefined {
  const group = getGroup(groupId);
  if (!group) return undefined;
  if (!group.memberIds.includes(userId)) {
    group.memberIds.push(userId);
    persist();
  }
  return group;
}

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
    trackIds: [],
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

export function updatePlaylistTracks(id: string, trackIds: string[]): Playlist | undefined {
  const playlist = getPlaylist(id);
  if (!playlist) return undefined;
  playlist.trackIds = trackIds;
  playlist.updatedAt = new Date().toISOString();
  persist();
  return playlist;
}
