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
  /** 副題からさらに辿れる先。アルバムならアーティストのページ。 */
  subtitleLink?: { kind: CollectionKind; id: string };
  /** アーティストの場合の登録者数。 */
  subscriberCount?: number;
  /** アーティストの場合の月間リスナー数。 */
  monthlyListeners?: number;
  /** アーティストの紹介文。 */
  description?: string;
  artworkUrl?: string;
  tracks: Track[];
  /* アーティストを開いたときだけ入る。まとまりを並べて見せるため。 */
  albums?: AlbumSummary[];
  singles?: AlbumSummary[];
  related?: ArtistSummary[];
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

/* ------------------------------------------------------------------ *
 * 歌詞
 * ------------------------------------------------------------------ */

/** 時刻の付いた 1 行。 */
export interface LyricsLine {
  /** 曲の頭からの位置 (ミリ秒)。 */
  timeMs: number;
  text: string;
}

/**
 * 歌詞の取得結果。
 *
 * 時刻付きなら再生に合わせて送れる。本文だけのときは並べて出す。
 * どちらも無い場合でも、自分で探しに行く先だけは返す。
 */
export type LyricsResult =
  | { kind: "synced"; source: string; lines: LyricsLine[]; searchUrl?: string }
  | { kind: "plain"; source: string; text: string; searchUrl?: string }
  | { kind: "instrumental"; source: string; searchUrl?: string }
  | { kind: "none"; searchUrl?: string };

/* ------------------------------------------------------------------ *
 * おすすめ
 *
 * 何を勧めるかを自前で考えるのではなく、手掛かり (種) だけこちらで決め、
 * 並べるのは供給元の推薦に任せる。そのほうが精度が出るし、
 * こちらで好みを溜め込まずに済む。
 * ------------------------------------------------------------------ */

/** ある曲を種にして、続けて流す曲を並べたもの。 */
export interface RadioResponse {
  tracks: Track[];
}

export type DiscoverItem =
  /*
   * 曲の札に添える副題。
   *
   * 供給元が演奏者ではなく再生回数を副題に置いていることがある。
   * その場合 track.artist は「不明」になるので、出すものをここで持つ。
   */
  | { type: "track"; track: Track; subtitle?: string }
  | { type: "playlist"; id: string; title: string; subtitle?: string; artworkUrl?: string }
  | { type: "album"; id: string; title: string; subtitle?: string; artworkUrl?: string };

export interface DiscoverSection {
  title: string;
  items: DiscoverItem[];
}

/** 地域向けの汎用のおすすめ。自分の好みは反映されない。 */
export interface DiscoverResponse {
  sections: DiscoverSection[];
}

/* ------------------------------------------------------------------
 * 聴いた跡
 *
 * 何をいつ聴いたかは、その人の PC と、その人が繋いだ端末の間だけを
 * 行き来する。中央サーバーは通らない。誰が何を聴いたかを外に出さない
 * ための線引きで、ここが崩れると設計の前提が変わる。
 *
 * 端末は電話を替えたり、覚えているものを消したりする。
 * PC のほうが長生きするので、そちらを寄せ集める場所にする。
 * ------------------------------------------------------------------ */

/** 一回ぶんの聴いた跡。 */
export interface HistoryEntry {
  track: Track;
  /** 再生を始めた時刻 (epoch ms)。同じ曲を区別する手掛かりでもある。 */
  playedAt: number;
  /** 実際に鳴った長さ。途中で送った場合はそのぶん短い。 */
  playedMs: number;
}

/** 端末から預ける跡と、前に突き合わせたのがいつまでかの印。 */
export interface HistoryMergeRequest {
  entries: HistoryEntry[];
  /**
   * 前に突き合わせたときに受け取った印。
   *
   * PC が「いつ預かったか」で数えた番号で、聴いた時刻とは別物。
   * これより後に預かったぶんだけ返せば、往復で運ぶ量が減る。
   *
   * 聴いた時刻で削ると、別の端末があとから足した古い跡を取りこぼす。
   * 「いつ聴いたか」と「いつこちらに届いたか」は順番が一致しない。
   *
   * 初めてなら省く。そのときは直近のぶんがまとめて返る。
   */
  since?: number;
}

export interface HistoryMergeResponse {
  /** 端末がまだ知らないぶん。新しい順。 */
  entries: HistoryEntry[];
  /** PC 側が覚えている総数。 */
  total: number;
  /** 端末から受け取って、初めて知ったものの数。 */
  added: number;
  /** 次に突き合わせるときに渡す印。 */
  cursor: number;
}

export const NODE_ROUTES = {
  health: "/api/health",
  search: "/api/search",
  lyrics: "/api/lyrics",
  radio: "/api/radio",
  discover: "/api/discover",
  /** アルバム・プレイリスト・アーティストの中身。 */
  collection: "/api/collection",
  resolve: "/api/resolve",
  stream: "/api/stream",
  /** ジャケット画像の中継。クライアントを外部へ直接アクセスさせないため。 */
  artwork: "/api/artwork",
  cache: "/api/cache",
  cacheStatus: "/api/cache/status",
  /** 聴いた跡。PC と端末の間だけで寄せ合う。中央は通らない。 */
  history: "/api/history",
  historyMerge: "/api/history/merge",
} as const;
