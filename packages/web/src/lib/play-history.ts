import type { Track } from "@sharetify/shared";

/**
 * 何をいつ聴いたかの控え。
 *
 * この端末の中だけに置く。中央サーバーへ送るのは、
 * 後で集計したごく粗い値だけ (よく聴く演奏者の上位など)。
 * 誰が何を聴いたかを外に出さないための線引き。
 *
 * おすすめの「種」はここから選ぶ。何を勧めるかを自前で考えるのではなく、
 * 手掛かりだけこちらで決めて、あとは供給元の推薦に委ねる。
 */

const STORAGE_KEY = "sharetify.history";
/** 残す件数。古いものから落とす。 */
const MAX_ENTRIES = 3000;
/** これ未満しか鳴っていない曲は「聴いた」と数えない。 */
const MIN_PLAYED_MS = 20_000;

export interface HistoryEntry {
  track: Track;
  /** 再生を始めた時刻 (epoch ms)。 */
  playedAt: number;
  /** 実際に鳴った長さ。途中で送った場合はそのぶん短い。 */
  playedMs: number;
}

let cache: HistoryEntry[] | null = null;

/**
 * 跡が変わったことを知らせる先。
 *
 * ホームは開いた時点の跡から組み立てるので、
 * 消したことを伝えないと、消えたはずのものが並んだままになる。
 */
const listeners = new Set<() => void>();

export function onHistoryChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function notifyChanged(): void {
  for (const listener of listeners) listener();
}

function load(): HistoryEntry[] {
  if (cache) return cache;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    cache = raw ? (JSON.parse(raw) as HistoryEntry[]) : [];
  } catch {
    cache = [];
  }
  return cache;
}

function save(entries: HistoryEntry[]): void {
  cache = entries;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // 端末の空きが尽きたら、古い分を落として入れ直す。
    const trimmed = entries.slice(0, Math.floor(entries.length / 2));
    cache = trimmed;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
    } catch {
      // それでも駄目なら諦める。再生そのものには関わらない。
    }
  }
}

/** 聴き終えた (あるいは十分に聴いた) ことを記録する。 */
export function recordPlay(track: Track, playedMs: number): void {
  if (playedMs < MIN_PLAYED_MS) return;

  const entries = load();
  entries.unshift({ track, playedAt: Date.now(), playedMs });
  save(entries.slice(0, MAX_ENTRIES));
}

export function allHistory(): HistoryEntry[] {
  return load();
}

export function clearHistory(): void {
  cache = [];
  localStorage.removeItem(STORAGE_KEY);
  notifyChanged();
}

/** 何回ぶん覚えているか。消す前に見せて、判断してもらう。 */
export function historySize(): number {
  return load().length;
}

/* ------------------------------ 集計 ------------------------------ */

/** 直近に聴いたもの。同じ曲は最初の 1 件だけ残す。 */
export function recentTracks(limit = 12): Track[] {
  const seen = new Set<string>();
  const result: Track[] = [];

  for (const entry of load()) {
    if (seen.has(entry.track.id)) continue;
    seen.add(entry.track.id);
    result.push(entry.track);
    if (result.length >= limit) break;
  }
  return result;
}

interface Tally {
  track: Track;
  count: number;
  lastPlayedAt: number;
  totalMs: number;
}

function tallyTracks(since = 0, until = Number.MAX_SAFE_INTEGER): Map<string, Tally> {
  const tally = new Map<string, Tally>();

  for (const entry of load()) {
    if (entry.playedAt < since || entry.playedAt > until) continue;
    const current = tally.get(entry.track.id);
    if (current) {
      current.count += 1;
      current.totalMs += entry.playedMs;
      current.lastPlayedAt = Math.max(current.lastPlayedAt, entry.playedAt);
    } else {
      tally.set(entry.track.id, {
        track: entry.track,
        count: 1,
        totalMs: entry.playedMs,
        lastPlayedAt: entry.playedAt,
      });
    }
  }
  return tally;
}

export function topTracks(sinceMs = 0, limit = 12): Track[] {
  return [...tallyTracks(sinceMs).values()]
    .sort((a, b) => b.count - a.count || b.totalMs - a.totalMs)
    .slice(0, limit)
    .map((t) => t.track);
}

export interface ArtistTally {
  id?: string;
  name: string;
  artworkUrl?: string;
  count: number;
  totalMs: number;
}

export function topArtists(sinceMs = 0, limit = 10): ArtistTally[] {
  const tally = new Map<string, ArtistTally>();

  for (const entry of load()) {
    if (entry.playedAt < sinceMs) continue;
    const { artist, artistId, artworkUrl } = entry.track;
    if (!artist || artist === "不明") continue;

    const current = tally.get(artist);
    if (current) {
      current.count += 1;
      current.totalMs += entry.playedMs;
      current.id ??= artistId;
    } else {
      tally.set(artist, {
        id: artistId,
        name: artist,
        artworkUrl,
        count: 1,
        totalMs: entry.playedMs,
      });
    }
  }

  return [...tally.values()].sort((a, b) => b.count - a.count).slice(0, limit);
}

/**
 * 昔よく聴いたのに、しばらく開いていないもの。
 *
 * 「よく聴いた」と「間が空いた」の両方を満たすものを拾う。
 * 直近のものは別のところに出るので、ここでは外す。
 */
export function forgottenFavorites(limit = 12): Track[] {
  const now = Date.now();
  const quietDays = 60;
  const quietMs = quietDays * 24 * 60 * 60_000;

  return [...tallyTracks().values()]
    .filter((t) => t.count >= 3 && now - t.lastPlayedAt >= quietMs)
    .sort((a, b) => b.count - a.count)
    .slice(0, limit)
    .map((t) => t.track);
}

/** 腰を据えて聴いたもの。長い曲や、通しで鳴らしたもの。 */
export function longListens(limit = 12): Track[] {
  const longEnough = 20 * 60_000;

  return [...tallyTracks().values()]
    .filter((t) => (t.track.durationMs ?? 0) >= longEnough)
    .sort((a, b) => b.totalMs - a.totalMs)
    .slice(0, limit)
    .map((t) => t.track);
}

export interface Recap {
  label: string;
  from: number;
  to: number;
  trackCount: number;
  totalMs: number;
  topTracks: Track[];
  topArtists: ArtistTally[];
}

/** ある期間の振り返り。曲数と時間、よく聴いたものを並べる。 */
function recapFor(from: number, to: number, label: string): Recap | null {
  const entries = load().filter((e) => e.playedAt >= from && e.playedAt <= to);
  if (entries.length === 0) return null;

  const tally = tallyTracks(from, to);
  const artists = new Map<string, ArtistTally>();

  for (const entry of entries) {
    const name = entry.track.artist;
    if (!name || name === "不明") continue;
    const current = artists.get(name);
    if (current) {
      current.count += 1;
      current.totalMs += entry.playedMs;
    } else {
      artists.set(name, {
        id: entry.track.artistId,
        name,
        artworkUrl: entry.track.artworkUrl,
        count: 1,
        totalMs: entry.playedMs,
      });
    }
  }

  return {
    label,
    from,
    to,
    trackCount: entries.length,
    totalMs: entries.reduce((sum, e) => sum + e.playedMs, 0),
    topTracks: [...tally.values()]
      .sort((a, b) => b.count - a.count)
      .slice(0, 10)
      .map((t) => t.track),
    topArtists: [...artists.values()].sort((a, b) => b.count - a.count).slice(0, 5),
  };
}

export function monthlyRecap(): Recap | null {
  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  return recapFor(from, Date.now(), `${now.getMonth() + 1}月の振り返り`);
}

export function yearlyRecap(): Recap | null {
  const now = new Date();
  const from = new Date(now.getFullYear(), 0, 1).getTime();
  return recapFor(from, Date.now(), `${now.getFullYear()}年の振り返り`);
}

/** 聴いた時間を読みやすくする。 */
export function formatListeningTime(totalMs: number): string {
  const minutes = Math.round(totalMs / 60_000);
  if (minutes < 60) return `${minutes} 分`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} 時間` : `${hours} 時間 ${rest} 分`;
}

/**
 * おすすめの種。
 *
 * 同じ演奏者から二度選ばない。似た並びが横に続くと、
 * 勧められている幅が狭く見えてしまう。
 */
export function pickSeeds(limit = 3): Track[] {
  const weekMs = 7 * 24 * 60 * 60_000;
  const recentFavorites = topTracks(Date.now() - 4 * weekMs, 12);
  const allTime = topTracks(0, 12);

  const seeds: Track[] = [];
  const usedArtists = new Set<string>();

  // 直近の好みを先に。今の気分に近いほうが手掛かりとして強い。
  for (const track of [...recentFavorites, ...allTime]) {
    if (usedArtists.has(track.artist)) continue;
    usedArtists.add(track.artist);
    seeds.push(track);
    if (seeds.length >= limit) break;
  }
  return seeds;
}
