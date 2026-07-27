import type {
  CacheStatusResponse,
  CollectionKind,
  CollectionResponse,
  DiscoverResponse,
  LyricsResult,
  NodeHealth,
  RadioResponse,
  ResolveResponse,
  SearchResponse,
  Track,
} from "@sharetify/shared";
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

/*
 * 自分の PC への入口。
 *
 * 開発中は別に立てた配信役が取り次ぐので、その道を通る。
 * 配って回すものは画面と同じ所から配られているので、付け足す道は要らない。
 * 空を指定できるようにしておかないと、存在しない道を叩き続けることになる。
 */
const configuredBase = import.meta.env["VITE_NODE_BASE"];
const BASE = configuredBase === undefined ? "/node-api" : configuredBase;

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

/** アルバム・プレイリスト・アーティストを開く。 */
export function nodeCollection(kind: CollectionKind, id: string, signal?: AbortSignal) {
  const params = new URLSearchParams({ kind, id });
  return getJson<CollectionResponse>(`/api/collection?${params}`, signal);
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
export async function fetchTrackBlob(trackId: string): Promise<{ url: string; blob: Blob }> {
  const reply = await peerClient.request(
    { method: "GET", path: `/api/stream?trackId=${encodeURIComponent(trackId)}`, binary: true },
    5 * 60_000,
  );
  if (reply.error) throw new Error(reply.error);
  if (!reply.body) throw new Error("音声を受け取れませんでした。");
  return { url: URL.createObjectURL(reply.body), blob: reply.body };
}

/**
 * 端末に残すために取ってくる。
 * 経路がどちらでも同じように扱えるよう、ここで吸収する。
 */
export async function fetchTrackForOffline(trackId: string): Promise<Blob> {
  if (viaPeer()) {
    const { url, blob } = await fetchTrackBlob(trackId);
    URL.revokeObjectURL(url);
    return blob;
  }
  const response = await fetch(streamUrl(trackId));
  if (!response.ok) throw new Error("曲を取得できませんでした。");
  return await response.blob();
}

/** ある曲を種に、続けて流す曲を並べる。おすすめの主役。 */
export function nodeRadio(trackId: string, limit = 25, signal?: AbortSignal) {
  const params = new URLSearchParams({ trackId, limit: String(limit) });
  return getJson<RadioResponse>(`/api/radio?${params}`, signal);
}

/** 地域向けの汎用のおすすめ。 */
export function nodeDiscover(signal?: AbortSignal) {
  return getJson<DiscoverResponse>("/api/discover", signal);
}

/** 歌詞を探す。時刻付きが見つかれば再生に合わせて送れる。 */
export function nodeLyrics(track: Track, signal?: AbortSignal): Promise<LyricsResult> {
  const params = new URLSearchParams({
    trackId: track.id,
    title: track.title,
    artist: track.artist,
  });
  if (track.album) params.set("album", track.album);
  if (track.durationMs) params.set("durationMs", String(track.durationMs));
  return getJson<LyricsResult>(`/api/lyrics?${params}`, signal);
}

/* ------------------------------ 聴取記録 ------------------------------ */

export interface LastfmStatus {
  configured: boolean;
  connected: boolean;
  username?: string;
}

async function post<T>(path: string, body?: unknown): Promise<T> {
  if (viaPeer()) {
    const reply = await peerClient.request({ method: "POST", path, body });
    if (reply.error) throw new Error(reply.error);
    if (reply.status >= 400) throw new Error(describeStatus(reply.status, reply.json));
    return reply.json as T;
  }

  const response = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!response.ok) {
    const failure = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(failure?.error ?? `リクエストに失敗しました (${response.status})`);
  }
  return (await response.json()) as T;
}

export function lastfmStatus(): Promise<LastfmStatus> {
  return getJson<LastfmStatus>("/api/lastfm");
}

export function lastfmSetKeys(apiKey: string, apiSecret: string): Promise<LastfmStatus> {
  return post<LastfmStatus>("/api/lastfm/keys", { apiKey, apiSecret });
}

export function lastfmBegin(): Promise<{ token: string; authUrl: string }> {
  return post<{ token: string; authUrl: string }>("/api/lastfm/begin");
}

export function lastfmComplete(token: string): Promise<{ username: string }> {
  return post<{ username: string }>("/api/lastfm/complete", { token });
}

export function lastfmDisconnect(): Promise<LastfmStatus> {
  return post<LastfmStatus>("/api/lastfm/disconnect");
}

export function lastfmNowPlaying(track: unknown): Promise<{ ok: boolean }> {
  return post<{ ok: boolean }>("/api/lastfm/nowplaying", { track });
}

export function lastfmScrobble(track: unknown, playedAt: number): Promise<{ ok: boolean }> {
  return post<{ ok: boolean }>("/api/lastfm/scrobble", { track, playedAt });
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
