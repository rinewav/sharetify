import type { LyricsLine, LyricsResult, Track } from "@sharetify/shared";

/**
 * 歌詞を探してくる。
 *
 * 時刻の付いたものが手に入れば、再生に合わせて行を送れる。
 * 無ければ本文だけでも出す。どちらも無いときは、
 * 自分で探しに行くための入口だけ添える。
 *
 * 取りに行くのは各ユーザーの PC。中央サーバーは関与しない。
 */

const LRCLIB_ROOT = "https://lrclib.net/api";
/** 提供元が求めている名乗り。素性を明かしておく。 */
const USER_AGENT = "sharetify (https://github.com/sharetify)";

interface LrclibEntry {
  id?: number;
  trackName?: string;
  artistName?: string;
  duration?: number;
  instrumental?: boolean;
  plainLyrics?: string | null;
  syncedLyrics?: string | null;
}

/** `[mm:ss.xx] 詞` の並び。行頭に複数の時刻が付くこともある。 */
const TIMESTAMP = /\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]/g;

/**
 * 時刻付きの歌詞を行に分ける。
 * 空行も残す。間が空くところで詰めると、曲との対応がずれて見える。
 */
export function parseSyncedLyrics(raw: string): LyricsLine[] {
  const lines: LyricsLine[] = [];

  for (const rawLine of raw.split(/\r?\n/)) {
    TIMESTAMP.lastIndex = 0;
    const stamps: number[] = [];
    let match: RegExpExecArray | null;

    while ((match = TIMESTAMP.exec(rawLine)) !== null) {
      const minutes = Number(match[1]);
      const seconds = Number(match[2]);
      // 小数部は桁数がまちまち。2 桁なら 1/100 秒、3 桁なら 1/1000 秒。
      const fraction = match[3] ?? "";
      const fractionMs =
        fraction.length === 0
          ? 0
          : fraction.length <= 2
            ? Number(fraction.padEnd(2, "0")) * 10
            : Number(fraction.slice(0, 3).padEnd(3, "0"));
      stamps.push(minutes * 60_000 + seconds * 1000 + fractionMs);
    }

    if (stamps.length === 0) continue;

    const text = rawLine.replace(TIMESTAMP, "").trim();
    for (const timeMs of stamps) lines.push({ timeMs, text });
  }

  return lines.sort((a, b) => a.timeMs - b.timeMs);
}

async function callLrclib(path: string): Promise<unknown> {
  const response = await fetch(`${LRCLIB_ROOT}${path}`, {
    headers: { "User-Agent": USER_AGENT },
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) return null;
  return await response.json();
}

/** 長さが近いものほど同じ音源に当たりやすい。 */
function pickClosest(entries: LrclibEntry[], durationSec?: number): LrclibEntry | undefined {
  const usable = entries.filter((e) => e.syncedLyrics || e.plainLyrics);
  if (usable.length === 0) return undefined;
  if (!durationSec) return usable[0];

  return usable.reduce((best, entry) => {
    const gap = Math.abs((entry.duration ?? 0) - durationSec);
    const bestGap = Math.abs((best.duration ?? 0) - durationSec);
    return gap < bestGap ? entry : best;
  });
}

function toResult(entry: LrclibEntry, track: Track): LyricsResult {
  if (entry.instrumental) {
    return { kind: "instrumental", source: "lrclib", searchUrl: geniusSearchUrl(track) };
  }

  if (entry.syncedLyrics) {
    const lines = parseSyncedLyrics(entry.syncedLyrics);
    if (lines.length > 0) {
      return { kind: "synced", source: "lrclib", lines, searchUrl: geniusSearchUrl(track) };
    }
  }

  if (entry.plainLyrics) {
    return {
      kind: "plain",
      source: "lrclib",
      text: entry.plainLyrics,
      searchUrl: geniusSearchUrl(track),
    };
  }

  return { kind: "none", searchUrl: geniusSearchUrl(track) };
}

/**
 * 見つからなかったときの逃げ道。
 * 本文を勝手に取ってくることはせず、探しに行く場所だけ示す。
 */
function geniusSearchUrl(track: Track): string {
  const query = `${track.artist} ${track.title}`.trim();
  return `https://genius.com/search?q=${encodeURIComponent(query)}`;
}

export async function fetchLyrics(track: Track): Promise<LyricsResult> {
  const durationSec = track.durationMs ? Math.round(track.durationMs / 1000) : undefined;

  // まずは題名と演奏者で正面から当てる。長さも渡すと版を選び分けてくれる。
  try {
    const params = new URLSearchParams({
      artist_name: track.artist,
      track_name: track.title,
    });
    if (track.album) params.set("album_name", track.album);
    if (durationSec) params.set("duration", String(durationSec));

    const direct = (await callLrclib(`/get?${params}`)) as LrclibEntry | null;
    if (direct?.id) return toResult(direct, track);
  } catch {
    // 当たらなければ次の手に進む。
  }

  // 表記の揺れで外すことがあるので、言葉で探し直す。
  try {
    const query = new URLSearchParams({ q: `${track.artist} ${track.title}` });
    const found = (await callLrclib(`/search?${query}`)) as LrclibEntry[] | null;
    if (Array.isArray(found) && found.length > 0) {
      const best = pickClosest(found, durationSec);
      if (best) return toResult(best, track);
    }
  } catch {
    // ここも外したら、探し先だけ返す。
  }

  return { kind: "none", searchUrl: geniusSearchUrl(track) };
}
