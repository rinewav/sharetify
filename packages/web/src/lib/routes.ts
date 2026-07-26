/** 仮組みの段階では URL を持たない素朴なルーター。後で history API に載せ替える。 */
export type Route =
  | { name: "home" }
  | { name: "search" }
  | { name: "groups" }
  | { name: "playlist"; playlistId: string };
