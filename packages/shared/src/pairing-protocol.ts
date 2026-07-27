/**
 * ペアリングと、その上を流れる要求／応答。
 *
 * 目的は「自分のスマートフォンから自分の PC へ、設定なしで繋がること」。
 * 中央サーバーは両者を引き合わせるところまでしか関わらない。
 * 一度つながれば以降のやり取りは直接行き来し、音声が中央を通ることはない。
 *
 *   1. PC 側が中央に名乗り出て、短い合言葉を受け取る
 *   2. スマートフォン側がその合言葉を入力する
 *   3. 中央が両者の接続情報だけを取り次ぐ
 *   4. 直結できたら中央は用済み
 */

/** 合言葉の桁数。手で打てる長さに収める。 */
export const PAIR_CODE_LENGTH = 6;
/** 合言葉の有効時間。 */
export const PAIR_CODE_TTL_MS = 5 * 60_000;

export const PAIR_ROUTE = "/pair";

/* ------------------------------------------------------------------ *
 * 中央との取り次ぎ
 * ------------------------------------------------------------------ */

/** PC 側 → 中央 */
export type HostMessage =
  /**
   * 名乗り出て合言葉をもらう。前回の合言葉があれば引き継ぐ。
   *
   * `identity` は、その合言葉を前に使っていたのと同じ相手かを見分けるための印。
   * これが無いと、別の PC が先に名乗って横取りできてしまう。
   * 中央はこの印を照らし合わせるだけで、誰が何を聴いているかは知らない。
   */
  | { type: "host:register"; previousCode?: string; identity?: string; label?: string }
  /** 接続情報の受け渡し。中身は覗かず、そのまま相手へ渡される。 */
  | { type: "host:signal"; guestId: string; payload: SignalPayload };

/** スマートフォン側 → 中央 */
export type GuestMessage =
  | { type: "guest:claim"; code: string }
  | { type: "guest:signal"; payload: SignalPayload };

/** 中央 → PC 側 */
export type HostEvent =
  | { type: "host:registered"; code: string; expiresAt: number }
  | { type: "host:guest-joined"; guestId: string }
  | { type: "host:guest-left"; guestId: string }
  | { type: "host:signal"; guestId: string; payload: SignalPayload }
  | { type: "error"; message: string };

/** 中央 → スマートフォン側 */
export type GuestEvent =
  | { type: "guest:linked"; hostLabel?: string }
  | { type: "guest:signal"; payload: SignalPayload }
  | { type: "guest:host-left" }
  | { type: "error"; message: string };

/** 接続に必要な情報。中央はこれを解釈しない。 */
export type SignalPayload =
  | { kind: "offer"; sdp: string }
  | { kind: "answer"; sdp: string }
  | { kind: "candidate"; candidate: string; mid?: string };

/* ------------------------------------------------------------------ *
 * 直結したあとのやり取り
 * ------------------------------------------------------------------ */

/**
 * 直結後は、ふだんの API と同じ形の要求をそのまま流す。
 * こうしておけば、直結していない環境との差がここ 1 箇所に収まる。
 */
export interface PeerRequest {
  id: string;
  method: "GET" | "POST";
  /** node から見たパス。例: /api/search?q=... */
  path: string;
  /** JSON 本文。GET では省略。 */
  body?: unknown;
  /** 音声のように大きいものを受け取るかどうか。 */
  binary?: boolean;
}

export interface PeerResponseHead {
  id: string;
  status: number;
  contentType?: string;
  /** 本文の総バイト数。分かる場合のみ。 */
  length?: number;
  /** JSON 応答はここに入る。二値応答では省略。 */
  json?: unknown;
  error?: string;
}

/** 直結の上を流れる制御メッセージ。本文そのものは二値フレームで送る。 */
export type PeerControl =
  | ({ type: "request" } & PeerRequest)
  | ({ type: "response" } & PeerResponseHead)
  | { type: "chunk-end"; id: string }
  | { type: "abort"; id: string };

/**
 * 二値フレームの先頭に付ける印。
 * どの要求に対する断片かを示すため、要求 ID を固定長で埋めておく。
 */
export const PEER_FRAME_ID_BYTES = 16;

export function encodeFrameId(id: string): Uint8Array {
  const bytes = new Uint8Array(PEER_FRAME_ID_BYTES);
  const hex = id.replace(/-/g, "").slice(0, PEER_FRAME_ID_BYTES * 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = Number.parseInt(hex.slice(i, i + 2), 16);
  }
  return bytes;
}

export function decodeFrameId(bytes: Uint8Array): string {
  return Array.from(bytes.subarray(0, PEER_FRAME_ID_BYTES))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** 断片 1 つあたりの上限。大きすぎると届かないことがあるので控えめに刻む。 */
export const PEER_CHUNK_BYTES = 16 * 1024;
