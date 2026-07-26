/**
 * ドメイン型。
 *
 * 設計上の大原則:
 *   中央サーバー (hub) が保持してよいのは「識別子とメタデータ」だけ。
 *   音声そのもの (バイト列) は hub を絶対に通らない。
 *   再生に必要な実体は、常に各ユーザーの PC 上の node が解決する。
 */

/** 供給元。将来ローカルファイルや他サービスを足せるように最初から抽象化しておく。 */
export type SourceKind = "remote" | "local";

/** 再生対象の最小単位。`sourceId` は供給元における ID (例: 動画 ID)。 */
export interface Track {
  id: string;
  sourceKind: SourceKind;
  sourceId: string;
  title: string;
  artist: string;
  album?: string;
  /** ミリ秒。不明なら undefined。 */
  durationMs?: number;
  artworkUrl?: string;
}

export interface Album {
  id: string;
  title: string;
  artist: string;
  artworkUrl?: string;
  year?: number;
  trackIds: string[];
}

export interface Artist {
  id: string;
  name: string;
  imageUrl?: string;
}

export interface Playlist {
  id: string;
  name: string;
  description?: string;
  /** 所有者の user id。共有プレイリストでは作成者を指す。 */
  ownerId: string;
  /** 属するグループ。個人プレイリストなら undefined。 */
  groupId?: string;
  artworkUrl?: string;
  trackIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface User {
  id: string;
  displayName: string;
  avatarUrl?: string;
}

/** 友だち同士の集まり。この中で共有プレイリストを複数持てる。 */
export interface Group {
  id: string;
  name: string;
  memberIds: string[];
  ownerId: string;
  createdAt: string;
}

/** ダウンロード / オフラインキャッシュの状態。 */
export type CacheState = "none" | "queued" | "downloading" | "ready" | "failed";

export interface CacheEntry {
  trackId: string;
  state: CacheState;
  /** 0..1 */
  progress: number;
  bytes?: number;
  error?: string;
}
