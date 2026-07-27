import type { CollectionKind } from "@sharetify/shared";

/** 仮組みの段階では URL を持たない素朴なルーター。後で history API に載せ替える。 */
export type Route =
  | { name: "home" }
  /** 探す場所。語を添えると、開いた時点でそれを入れておく。 */
  | { name: "search"; query?: string }
  | { name: "groups" }
  /** 気に入った曲をまとめた場所。 */
  | { name: "likes" }
  | { name: "playlist"; playlistId: string }
  /** 検索から開いたアルバム・プレイリスト・アーティスト。 */
  | { name: "collection"; kind: CollectionKind; id: string; title?: string };
