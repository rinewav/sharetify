/**
 * アートワークのプレースホルダ。
 *
 * 外部の画像を取りに行かずに済ませたいので、ID から決定的に色を作って
 * グラデーションで埋める。同じ曲はいつ見ても同じ色になる。
 */

function hash(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

export function artworkGradient(seed: string): string {
  const h = hash(seed);
  const hueA = h % 360;
  // 補色に寄せすぎると濁るので、40〜100度ずらした範囲に収める。
  const hueB = (hueA + 40 + (h % 60)) % 360;
  const satA = 45 + (h % 25);
  const satB = 40 + ((h >> 3) % 25);
  return `linear-gradient(145deg, hsl(${hueA} ${satA}% 42%), hsl(${hueB} ${satB}% 22%))`;
}

/** アートワークの上に置く頭文字。 */
export function artworkInitial(title: string): string {
  return title.trim().charAt(0).toUpperCase() || "♪";
}
