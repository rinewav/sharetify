import type { Group, Playlist, Track, User } from "@musicshare/shared";

/**
 * 仮組み用のデータ。
 *
 * 実体は node (各自の PC) と hub (中央) から来る。ここは UI を先に完成させるための足場で、
 * API が繋がったら差し替える。
 */

function track(
  id: string,
  title: string,
  artist: string,
  album: string,
  seconds: number,
): Track {
  return {
    id,
    sourceKind: "remote",
    sourceId: id,
    title,
    artist,
    album,
    durationMs: seconds * 1000,
  };
}

export const mockTracks: Track[] = [
  track("t1", "Midnight Corridor", "Aoi Tsuzuki", "Nocturne Ward", 214),
  track("t2", "Paper Lantern", "Aoi Tsuzuki", "Nocturne Ward", 187),
  track("t3", "Static Bloom", "Hollow Field", "Signal Decay", 245),
  track("t4", "Undertow", "Hollow Field", "Signal Decay", 302),
  track("t5", "Glass Arcade", "Neon Pastoral", "Weekday Ghosts", 198),
  track("t6", "Low Ceiling", "Neon Pastoral", "Weekday Ghosts", 232),
  track("t7", "Sodium Light", "Marina Vex", "Terminal Bloom", 176),
  track("t8", "Half Awake", "Marina Vex", "Terminal Bloom", 258),
  track("t9", "Cassette Rain", "The Long Commute", "Platform Four", 221),
  track("t10", "Fold the Map", "The Long Commute", "Platform Four", 265),
  track("t11", "Amber Static", "Kite Season", "Thermals", 193),
  track("t12", "Everything Nearby", "Kite Season", "Thermals", 241),
];

export const mockUsers: User[] = [
  { id: "u1", displayName: "りね" },
  { id: "u2", displayName: "ゆき" },
  { id: "u3", displayName: "そう" },
  { id: "u4", displayName: "はる" },
];

export const mockGroups: Group[] = [
  {
    id: "g1",
    name: "深夜の作業部屋",
    ownerId: "u1",
    memberIds: ["u1", "u2", "u3"],
    createdAt: "2026-05-02T12:00:00.000Z",
  },
  {
    id: "g2",
    name: "レファレンス置き場",
    ownerId: "u1",
    memberIds: ["u1", "u4"],
    createdAt: "2026-06-18T09:30:00.000Z",
  },
];

function playlist(
  id: string,
  name: string,
  trackIds: string[],
  extra: Partial<Playlist> = {},
): Playlist {
  return {
    id,
    name,
    ownerId: "u1",
    trackIds,
    createdAt: "2026-05-02T12:00:00.000Z",
    updatedAt: "2026-07-20T21:14:00.000Z",
    ...extra,
  };
}

export const mockPlaylists: Playlist[] = [
  playlist("p1", "夜に効くやつ", ["t1", "t3", "t5", "t7", "t9"], {
    description: "作業中にずっと流している",
  }),
  playlist("p2", "みんなの棚", ["t2", "t4", "t6", "t8", "t10", "t12"], {
    groupId: "g1",
    description: "深夜の作業部屋の共有プレイリスト",
  }),
  playlist("p3", "リファレンス / ミックス", ["t11", "t12", "t1", "t4"], {
    groupId: "g2",
    description: "音作りの参照用",
  }),
  playlist("p4", "散歩", ["t5", "t9", "t11", "t2"]),
  playlist("p5", "最近見つけたもの", ["t7", "t8", "t3"]),
];

export function trackById(id: string): Track | undefined {
  return mockTracks.find((t) => t.id === id);
}

export function tracksOf(playlist: Playlist): Track[] {
  return playlist.trackIds
    .map((id) => trackById(id))
    .filter((t): t is Track => t !== undefined);
}
