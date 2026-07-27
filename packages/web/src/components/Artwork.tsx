import { useEffect, useState } from "react";
import { artworkGradient, artworkInitial } from "../lib/artwork.js";
import { artworkUrl } from "../lib/node-client.js";

interface Props {
  seed: string;
  label: string;
  /** 供給元のジャケット URL。中継を挟んで読み込む。 */
  src?: string;
  className?: string;
  rounded?: string;
}

/**
 * ジャケット。
 *
 * 画像があればそれを出し、無いか読めなかったときは ID から決めた色で埋める。
 * 色は ID から決まるので、同じ曲はいつ見ても同じ見た目になる。
 */
export function Artwork({ seed, label, src, className = "size-12", rounded = "rounded" }: Props) {
  const [failed, setFailed] = useState(false);
  const resolved = artworkUrl(src);

  // 別の曲に差し替わったら、前の失敗を引きずらない。
  useEffect(() => setFailed(false), [resolved]);

  const shared = `${className} ${rounded} shrink-0 overflow-hidden shadow-lg shadow-black/40`;

  if (resolved && !failed) {
    return (
      <img
        src={resolved}
        alt=""
        loading="lazy"
        decoding="async"
        onError={() => setFailed(true)}
        className={`${shared} bg-surface-3 object-cover`}
      />
    );
  }

  return (
    <div
      className={`${shared} grid place-items-center`}
      style={{ background: artworkGradient(seed) }}
      aria-hidden="true"
    >
      <span className="text-[0.7em] font-semibold tracking-tight text-white/70">
        {artworkInitial(label)}
      </span>
    </div>
  );
}
