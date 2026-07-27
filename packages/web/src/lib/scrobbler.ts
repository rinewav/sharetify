import type { Track } from "@musicshare/shared";
import { lastfmNowPlaying, lastfmScrobble } from "./node-client.js";
import { recordPlay } from "./play-history.js";

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
  /** 手元の控えに残したか。連携の有無とは別に管理する。 */
  recorded: boolean;
  lastPositionMs: number;
}

let current: Pending | null = null;
/** 連携していないときに毎回問い合わせないための覚え書き。 */
let enabled = true;

export function setScrobblingEnabled(value: boolean): void {
  enabled = value;
}

/** 曲が変わったときに呼ぶ。 */
export function trackStarted(track: Track): void {
  // 前の曲がここまで鳴っていたことを、切り替わる時点で残す。
  flushToHistory();

  current = {
    track,
    startedAt: Math.floor(Date.now() / 1000),
    reported: false,
    recorded: false,
    lastPositionMs: 0,
  };
  if (!enabled) return;
  void lastfmNowPlaying(track).catch(() => setScrobblingEnabled(false));
}

/** 再生位置が進むたびに呼ぶ。条件を満たした時点で一度だけ送る。 */
export function trackProgressed(track: Track, positionMs: number, durationMs: number): void {
  if (!current || current.track.id !== track.id) return;
  current.lastPositionMs = positionMs;

  if (durationMs < MIN_TRACK_MS) return;
  const enough = positionMs >= Math.min(durationMs / 2, SCROBBLE_AFTER_MS);
  if (!enough) return;

  // 手元の控えは連携の有無に関わらず残す。おすすめの手掛かりになる。
  if (!current.recorded) {
    current.recorded = true;
    recordPlay(track, positionMs);
  }

  if (!enabled || current.reported) return;
  current.reported = true;
  void lastfmScrobble(track, current.startedAt).catch(() => setScrobblingEnabled(false));
}

/**
 * 途中で切り替えた分を控えに残す。
 * 半分まで届かなかったものは、聴いたとは数えない。
 */
function flushToHistory(): void {
  if (!current || current.recorded) return;
  const duration = current.track.durationMs ?? 0;
  if (duration > 0 && current.lastPositionMs >= duration / 2) {
    recordPlay(current.track, current.lastPositionMs);
  }
}

export function resetScrobbler(): void {
  current = null;
  enabled = true;
}
