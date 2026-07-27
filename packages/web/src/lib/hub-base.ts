/**
 * 中央サーバーの場所。
 *
 * ここを見に行く所が三つあり、それぞれで既定を書いていた。
 * 一つでも取り違えると、片方だけ別の中央につながって噛み合わなくなる。
 * 決めるのはここ一箇所にする。
 */

const configured = import.meta.env["VITE_HUB_BASE"];

/**
 * 開発中は同じ入口の中で取り次ぐので、その道を通る。
 * 配ったものには実際の行き先が焼き込まれる。
 * 中央から配られたものは空になり、開いた所がそのまま中央になる。
 */
export const HUB_BASE = configured === undefined ? "/hub-api" : configured;

/** 常時つないだ経路の行き先。中央と同じ所へ、方式だけ変えて向かう。 */
export function hubSocketUrl(path: string, params: Record<string, string> = {}): string {
  /*
   * 焼き込まれた行き先は、それ自体が完全な住所のことがある。
   * その場合は開いている場所を基準にしてはいけない。
   */
  const url = HUB_BASE.startsWith("http")
    ? new URL(path, HUB_BASE)
    : new URL(`${HUB_BASE}${path}`, window.location.origin);

  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return url.toString();
}
