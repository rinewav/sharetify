import type {
  NodeHealth,
  ResolveResponse,
  SearchResponse,
  CacheStatusResponse,
} from "@musicshare/shared";
import { peerClient } from "./peer-client.js";

/**
 * 自分の PC 上の node への接続。
 *
 * 経路は 2 つあり、呼び出す側はどちらかを意識しない。
 *
 *   1. 直結 — 合言葉でつないだ場合。中央を通らず PC と直接やり取りする
 *   2. 同一オリジンへの中継 — 同じネットワークにいる場合の開発用
 *
 * 中継のほうを使うとき、外部の URL をブラウザから直接叩かせないのが要点。
 * スマートフォンからは HTTPS で入ってくるので、
 * HTTP の node を直に触ると混在コンテンツで弾かれる。
 */

const BASE = import.meta.env["VITE_NODE_BASE"] ?? "/node-api";

/** 直結が使える状態か。 */
function viaPeer(): boolean {
  return peerClient.ready;
}

async function getJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  if (viaPeer()) {
    const reply = await peerClient.request({ method: "GET", path });
    if (reply.error) throw new Error(reply.error);
    if (reply.status >= 400) {
      throw new Error(describeStatus(reply.status, reply.json));
    }
    return reply.json as T;
  }

  const response = await fetch(`${BASE}${path}`, { signal });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `リクエストに失敗しました (${response.status})`);
  }
  return (await response.json()) as T;
}

function describeStatus(status: number, json: unknown): string {
  const message = (json as { error?: string } | undefined)?.error;
  return message ?? `リクエストに失敗しました (${status})`;
}

export function nodeHealth(signal?: AbortSignal): Promise<NodeHealth> {
  return getJson<NodeHealth>("/api/health", signal);
}

export function nodeSearch(query: string, limit = 20, signal?: AbortSignal) {
  const params = new URLSearchParams({ q: query, limit: String(limit) });
  return getJson<SearchResponse>(`/api/search?${params}`, signal);
}

export function nodeResolve(trackId: string, signal?: AbortSignal) {
  const params = new URLSearchParams({ trackId });
  return getJson<ResolveResponse>(`/api/resolve?${params}`, signal);
}

export function nodeCacheStatus(signal?: AbortSignal) {
  return getJson<CacheStatusResponse>("/api/cache/status", signal);
}

export async function nodeCache(trackIds: string[]): Promise<void> {
  if (viaPeer()) {
    await peerClient.request({ method: "POST", path: "/api/cache", body: { trackIds } });
    return;
  }
  await fetch(`${BASE}/api/cache`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ trackIds }),
  });
}

/**
 * 再生に渡す URL。
 *
 * 中継経路なら node の URL をそのまま使えるので、範囲指定も追い読みも効く。
 * 直結の場合は一度受け取りきってから渡す。
 * 受け取り終えるまで音は出せないが、そのぶん途中の飛び先も自由になる。
 */
export function streamUrl(trackId: string): string {
  return `${BASE}/api/stream?trackId=${encodeURIComponent(trackId)}`;
}

export function canStreamDirectly(): boolean {
  return !viaPeer();
}

/** 直結のときに、曲を受け取って再生できる形にする。 */
export async function fetchTrackObjectUrl(trackId: string): Promise<string> {
  const reply = await peerClient.request(
    { method: "GET", path: `/api/stream?trackId=${encodeURIComponent(trackId)}`, binary: true },
    5 * 60_000,
  );
  if (reply.error) throw new Error(reply.error);
  if (!reply.body) throw new Error("音声を受け取れませんでした。");
  return URL.createObjectURL(reply.body);
}

/**
 * ジャケットも node 経由で取る。
 * クライアントから外部へ直接取りに行かせない方針をここでも通す。
 */
export function artworkUrl(source: string | undefined): string | undefined {
  if (!source) return undefined;
  // 直結中は画像を個別に取りに行くと要求が増えるので、中継の口をそのまま使う。
  return `${BASE}/api/artwork?url=${encodeURIComponent(source)}`;
}
