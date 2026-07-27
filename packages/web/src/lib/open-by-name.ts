import { nodeSearch } from "./node-client.js";
import type { Route } from "./routes.js";

/**
 * 名前しか分からない相手の場所へ行く。
 *
 * 供給元は、いつも識別子を添えてくれるわけではない。
 * プレイリストの作り手などは名前だけで返ってくる。
 * その名前で探し、同じ名前の人が見つかればその場所へ、
 * 見つからなければ探した結果へ連れていく。
 *
 * 押しても何も起きないのがいちばん困る。
 * 確実に辿れないなら、せめて探すところまでは進める。
 */

/**
 * 「含む」で同じ人と見なしてよい、名前の短さの下限。
 *
 * これより短いものは、たまたま他の名前の一部になっていることがある。
 */
const MIN_CONTAINS = 4;

/** 見比べるために、揺れを均す。 */
function flatten(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[\s　・･,、]/g, "");
}

export async function openByName(
  name: string,
  navigate: (route: Route) => void,
): Promise<void> {
  const trimmed = name.trim();
  if (!trimmed) return;

  try {
    const found = await nodeSearch(trimmed, 6);
    const flat = flatten(trimmed);

    /*
     * 名前がそのまま合うものを選ぶ。
     * 部分一致まで拾うと、関係のない人の場所へ連れて行きかねない。
     * ただし「Kenshi Yonezu 米津玄師」のように二つ並べた書き方もあるので、
     * 片方が片方を含む場合までは同じ人と見なす。
     *
     * 含むかどうかで判ずるのは、短い名前では危うい。
     * 「Ado」は「Adobe Sound Studio」に含まれてしまう。
     * 短いものは、そのまま合うときだけ同じ人と見なす。
     */
    const 含んでよい = (value: string) => value.length >= MIN_CONTAINS;
    const hit = found.artists.find((artist) => {
      const other = flatten(artist.name);
      if (other === flat) return true;
      if (含んでよい(other) && flat.includes(other)) return true;
      return 含んでよい(flat) && other.includes(flat);
    });

    if (hit) {
      navigate({ name: "collection", kind: "artist", id: hit.id, title: hit.name });
      return;
    }
  } catch {
    // 探せなかった。せめて探すところまでは連れていく。
  }

  navigate({ name: "search", query: trimmed });
}
