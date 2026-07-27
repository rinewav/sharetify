/**
 * node プロトコル — クライアント (PWA / Electron のレンダラー) から
 * 「自分の PC 上で動いている node サーバー」へ話しかけるための HTTP API。
 *
 * この経路にだけ音声の実体が流れる。中央サーバーは一切関与しない。
 */

import type {
  AlbumSummary,
  ArtistSummary,
  CacheEntry,
  CollectionKind,
  PlaylistSummary,
  Track,
} from "./domain.js";

export const NODE_DEFAULT_PORT = 47821;

/** node が生きているか、どのバージョンか。 */
export interface NodeHealth {
  ok: true;
  version: string;
  /** ストリーム解決に使うバックエンドが利用可能か。false なら再生できない。 */
  resolverReady: boolean;
  /** 解決バックエンドが壊れている場合の説明 (更新が必要、など)。 */
  resolverMessage?: string;
  cachedTrackCount: number;
}

export interface SearchRequest {
  query: string;
  limit?: number;
}

/**
 * 検索結果。
 *
 * 曲だけを返すと、アルバムやアーティストで探している人が行き止まりになる。
 * 種別ごとに分けて返し、表示側でまとまりごとに並べる。
 */
export interface SearchResponse {
  tracks: Track[];
  albums: AlbumSummary[];
  artists: ArtistSummary[];
  playlists: PlaylistSummary[];
}

/** アルバムやプレイリストを開いたときの中身。 */
export interface CollectionResponse {
  kind: CollectionKind;
  id: string;
  title: string;
  subtitle?: string;
  artworkUrl?: string;
  tracks: Track[];
}

/**
 * 再生用 URL の解決結果。
 * `url` は node 自身が配信するローカル URL であり、外部の URL をそのまま返さない。
 * こうしておくと CORS も Range も node が面倒を見られる。
 */
export interface ResolveResponse {
  trackId: string;
  url: string;
  mimeType: string;
  durationMs?: number;
  /** 既にキャッシュ済みで即座に再生できるか。 */
  cached: boolean;
}

export interface CacheRequest {
  trackIds: string[];
}

export interface CacheStatusResponse {
  entries: CacheEntry[];
}

export const NODE_ROUTES = {
  health: "/api/health",
  search: "/api/search",
  /** アルバム・プレイリスト・アーティストの中身。 */
  collection: "/api/collection",
  resolve: "/api/resolve",
  stream: "/api/stream",
  /** ジャケット画像の中継。クライアントを外部へ直接アクセスさせないため。 */
  artwork: "/api/artwork",
  cache: "/api/cache",
  cacheStatus: "/api/cache/status",
} as const;
