/**
 * hub プロトコル — クライアントから中央サーバーへの HTTP API と WebSocket。
 *
 * hub が扱ってよいもの: 識別子、メタデータ、再生位置。
 * hub が絶対に扱わないもの: 音声のバイト列。
 *
 * 同時リスニングは「配信」ではなく「同期」として実装する。
 * ホストが音を配るのではなく、参加者それぞれが自分の node から同じ音源を取得し、
 * hub は "いま何を何秒の位置で鳴らしているか" だけを配る。
 * この設計なので中継が要らず、hub の帯域は毎秒数十バイトに収まる。
 */

import type {
  FollowedArtist,
  Group,
  GroupMember,
  Playlist,
  Track,
  User,
} from "./domain.js";

export const HUB_DEFAULT_PORT = 47820;

export const HUB_ROUTES = {
  health: "/api/health",
  login: "/api/auth/login",
  me: "/api/me",
  groups: "/api/groups",
  groupJoin: "/api/groups/join",
  playlists: "/api/playlists",
  follows: "/api/follows",
  sessions: "/api/sessions",
  socket: "/ws",
} as const;

export interface LoginRequest {
  displayName: string;
}

export interface LoginResponse {
  token: string;
  user: User;
}

/** 集まりに、表示用のメンバー名を添えたもの。 */
export interface GroupWithMembers extends Group {
  members: GroupMember[];
}

export interface MeResponse {
  user: User;
  groups: GroupWithMembers[];
  playlists: Playlist[];
  follows: FollowedArtist[];
}

/* ------------------------------------------------------------------ *
 * 同時リスニング
 * ------------------------------------------------------------------ */

/** 参加者から見たセッションの現在地。 */
export interface ListeningState {
  /** 再生中のトラック。null なら停止中。 */
  track: Track | null;
  /** track の先頭からの位置 (ミリ秒)。`atServerTime` 時点での値。 */
  positionMs: number;
  /** positionMs を測った hub 側の時刻 (epoch ms)。 */
  atServerTime: number;
  paused: boolean;
  /** 再生キュー。全参加者で共有される。 */
  queue: Track[];
  queueIndex: number;
}

export interface ListeningSession {
  id: string;
  groupId: string;
  hostId: string;
  participantIds: string[];
  state: ListeningState;
}

/** クライアント → hub */
export type ClientMessage =
  /** 時刻同期。往復遅延を測って hub 時刻とのズレを求める。 */
  | { type: "sync:ping"; clientTime: number }
  | { type: "session:join"; sessionId: string }
  | { type: "session:leave" }
  /** ホストのみ。再生状態を動かす。 */
  | { type: "session:control"; action: SessionControl }
  /** 自分がその曲を用意できたか。全員揃うまで開始を待つために使う。 */
  | { type: "session:readiness"; trackId: string; ready: boolean; reason?: string };

export type SessionControl =
  | { kind: "play" }
  | { kind: "pause" }
  | { kind: "seek"; positionMs: number }
  | { kind: "next" }
  | { kind: "prev" }
  | { kind: "setQueue"; tracks: Track[]; startIndex: number };

/** hub → クライアント */
export type ServerMessage =
  | { type: "sync:pong"; clientTime: number; serverTime: number }
  | { type: "session:state"; session: ListeningSession }
  /** 誰がその曲を用意できていないか。UI に出して原因を可視化する。 */
  | { type: "session:readiness"; entries: ReadinessEntry[] }
  | { type: "session:closed"; reason: string }
  | { type: "error"; message: string };

export interface ReadinessEntry {
  userId: string;
  displayName: string;
  trackId: string;
  ready: boolean;
  reason?: string;
}

/**
 * 時刻同期の計算。
 *
 * NTP と同じ考え方で、往復にかかった時間の半分を片道遅延とみなし、
 * 「hub の時計 − 自分の時計」のズレを求める。
 * 求めた offset を使えば、hub 時刻をいつでも自分のローカル時刻に翻訳できる。
 */
export function computeClockOffset(
  clientSendTime: number,
  serverTime: number,
  clientRecvTime: number,
): { offsetMs: number; roundTripMs: number } {
  const roundTripMs = clientRecvTime - clientSendTime;
  const offsetMs = serverTime + roundTripMs / 2 - clientRecvTime;
  return { offsetMs, roundTripMs };
}

/**
 * 「いま自分は何秒の位置を鳴らしているべきか」を求める。
 *
 * hub が送ってくる state は測定時刻付きなので、そこから経過した分を足す。
 * offsetMs は computeClockOffset で求めた自分の時計のズレ。
 */
export function expectedPositionMs(
  state: ListeningState,
  offsetMs: number,
  now: number = Date.now(),
): number {
  if (state.paused) return state.positionMs;
  const serverNow = now + offsetMs;
  const elapsed = serverNow - state.atServerTime;
  return Math.max(0, state.positionMs + elapsed);
}

/** これ以上ズレたら黙って合わせにいく閾値 (ミリ秒)。 */
export const SYNC_DRIFT_NUDGE_MS = 40;
/** これ以上ズレたら諦めて一気にシークする閾値 (ミリ秒)。 */
export const SYNC_DRIFT_SEEK_MS = 400;
