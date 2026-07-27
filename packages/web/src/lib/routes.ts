import type { CollectionKind } from "@musicshare/shared";

/** 仮組みの段階では URL を持たない素朴なルーター。後で history API に載せ替える。 */
export type Route =
  | { name: "home" }
  | { name: "search" }
  | { name: "groups" }
  | { name: "playlist"; playlistId: string }
  /** 検索から開いたアルバム・プレイリスト・アーティスト。 */
  | { name: "collection"; kind: CollectionKind; id: string; title?: string };
