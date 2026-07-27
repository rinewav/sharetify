import type { Track } from "@musicshare/shared";
import { lastfmNowPlaying, lastfmScrobble } from "./node-client.js";

/**
 * 聴いた記録を残す。
 *
 * 送るかどうかの目安は集計側の慣習に合わせてある。
 * 半分まで聴いたか、4 分を超えたら一曲として数える。
 * 少しだけ流して次へ行ったものは記録しない。
 */

const MIN_TRACK_MS = 30_000;
const SCROBBLE_AFTER_MS = 4 * 60_000;

interface Pending {
  track: Track;
  /** 再生を始めた時刻 (秒)。集計側はこれを聴取時刻として扱う。 */
  startedAt: number;
  reported: boolean;
}

let current: Pending | null = null;
/** 連携していないときに毎回問い合わせないための覚え書き。 */
let enabled = true;

export function setScrobblingEnabled(value: boolean): void {
  enabled = value;
}

/** 曲が変わったときに呼ぶ。 */
export function trackStarted(track: Track): void {
  current = {
    track,
    startedAt: Math.floor(Date.now() / 1000),
    reported: false,
  };
  if (!enabled) return;
  void lastfmNowPlaying(track).catch(() => setScrobblingEnabled(false));
}

/** 再生位置が進むたびに呼ぶ。条件を満たした時点で一度だけ送る。 */
export function trackProgressed(track: Track, positionMs: number, durationMs: number): void {
  if (!enabled || !current || current.reported) return;
  if (current.track.id !== track.id) return;
  if (durationMs < MIN_TRACK_MS) return;

  const enough = positionMs >= Math.min(durationMs / 2, SCROBBLE_AFTER_MS);
  if (!enough) return;

  current.reported = true;
  void lastfmScrobble(track, current.startedAt).catch(() => setScrobblingEnabled(false));
}

export function resetScrobbler(): void {
  current = null;
  enabled = true;
}
