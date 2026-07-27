import type {
  NodeHealth,
  ResolveResponse,
  SearchResponse,
  CacheStatusResponse,
} from "@musicshare/shared";

/**
 * 自分の PC 上の node への接続。
 *
 * 開発時は同一オリジンの `/node` 配下に中継してある。
 * スマートフォンからは HTTPS で入ってくるので、HTTP の node を直接叩くと
 * 混在コンテンツで弾かれる。必ずこの相対パス経由で行くこと。
 */

const BASE = import.meta.env["VITE_NODE_BASE"] ?? "/node-api";

async function get<T>(path: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`${BASE}${path}`, { signal });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `リクエストに失敗しました (${response.status})`);
  }
  return (await response.json()) as T;
}

export function nodeHealth(signal?: AbortSignal): Promise<NodeHealth> {
  return get<NodeHealth>("/api/health", signal);
}

export function nodeSearch(query: string, limit = 20, signal?: AbortSignal) {
  const params = new URLSearchParams({ q: query, limit: String(limit) });
  return get<SearchResponse>(`/api/search?${params}`, signal);
}

export function nodeResolve(trackId: string, signal?: AbortSignal) {
  const params = new URLSearchParams({ trackId });
  return get<ResolveResponse>(`/api/resolve?${params}`, signal);
}

export function nodeCacheStatus(signal?: AbortSignal) {
  return get<CacheStatusResponse>("/api/cache/status", signal);
}

export async function nodeCache(trackIds: string[]): Promise<void> {
  await fetch(`${BASE}/api/cache`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ trackIds }),
  });
}

/**
 * 再生に渡す URL。
 *
 * node が返す `url` はそれ自身から見た相対パスなので、
 * こちらの中継プレフィックスを足して同一オリジンに乗せる。
 */
export function streamUrl(trackId: string): string {
  return `${BASE}/api/stream?trackId=${encodeURIComponent(trackId)}`;
}

/**
 * ジャケットも node 経由で取る。
 * クライアントから外部へ直接取りに行かせない方針をここでも通す。
 */
export function artworkUrl(source: string | undefined): string | undefined {
  if (!source) return undefined;
  return `${BASE}/api/artwork?url=${encodeURIComponent(source)}`;
}
