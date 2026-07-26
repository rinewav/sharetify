import { artworkGradient, artworkInitial } from "../lib/artwork.js";

interface Props {
  seed: string;
  label: string;
  className?: string;
  rounded?: string;
}

/** 画像を外から取らずに済ませるためのプレースホルダ。ID から色が決まる。 */
export function Artwork({ seed, label, className = "size-12", rounded = "rounded" }: Props) {
  return (
    <div
      className={`${className} ${rounded} grid shrink-0 place-items-center overflow-hidden shadow-lg shadow-black/40`}
      style={{ background: artworkGradient(seed) }}
      aria-hidden="true"
    >
      <span className="text-[0.7em] font-semibold tracking-tight text-white/70">
        {artworkInitial(label)}
      </span>
    </div>
  );
}
