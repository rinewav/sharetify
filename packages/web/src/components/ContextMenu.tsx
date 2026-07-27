import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export interface MenuItem {
  label: string;
  icon?: React.ReactNode;
  onSelect: () => void;
  /** 区切りを上に置く。関係の薄い操作を離すため。 */
  separated?: boolean;
  danger?: boolean;
}

interface Props {
  x: number;
  y: number;
  items: MenuItem[];
  onClose: () => void;
}

/**
 * 右クリックで出す品書き。
 *
 * 画面の端で切れないよう、出したあとに位置を測って収める。
 * どこかを押すか、画面が動いたら閉じる。
 */
export function ContextMenu({ x, y, items, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ x, y });

  // 描いてから測る。はみ出す分だけ内側へ寄せる。
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;

    /*
     * 実際に描かれている寸法ではなく、素の寸法で測る。
     *
     * 出るときに少し縮んだ状態から始まるので、描かれている寸法を見ると
     * 本来より小さく見え、そのぶん端で足りずにはみ出す。
     */
    const { offsetWidth: width, offsetHeight: height } = element;
    const margin = 8;
    setPosition({
      x: Math.min(x, window.innerWidth - width - margin),
      y: Math.min(y, window.innerHeight - height - margin),
    });
  }, [x, y]);

  useEffect(() => {
    /*
     * 品書きの中を押したときは閉じない。
     * 押した瞬間に消すと、そのあとの click が届かず選べなくなる。
     */
    const close = (event?: Event) => {
      const target = event?.target;
      if (target instanceof Node && ref.current?.contains(target)) return;
      onClose();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };

    // 次の間合いで登録する。開いたその押下で閉じてしまわないように。
    const timer = setTimeout(() => {
      window.addEventListener("pointerdown", close);
      window.addEventListener("wheel", close, { passive: true });
      window.addEventListener("resize", close);
    }, 0);
    window.addEventListener("keydown", onKey);

    return () => {
      clearTimeout(timer);
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("wheel", close);
      window.removeEventListener("resize", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  /*
   * 画面の隅ではなく、いちばん外側に描く。
   *
   * 途中に変形のかかった親があると、画面を基準に置いたつもりでも
   * その親が基準になってしまい、送り出した先が画面の外になる。
   * 品書きは中身の並びに属するものではないので、外に出しておく。
   */
  return createPortal(
    <>
      {/*
        後ろを少し沈める。
        指で開いたときは押した場所が指の下に隠れるので、
        いま何かを選んでいる最中だと分かる手掛かりが要る。
      */}
      <div className="animate-fade fixed inset-0 z-40 bg-black/25" aria-hidden />
      <div
        ref={ref}
        role="menu"
        style={{ left: position.x, top: position.y }}
        className="animate-pop fixed z-50 w-60 origin-top-left rounded-lg border border-line bg-surface-2 p-1 shadow-2xl"
      >
        {items.map((item, index) => (
          <div key={item.label}>
            {item.separated && index > 0 && <div className="my-1 h-px bg-line" />}
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                item.onSelect();
                onClose();
              }}
              // 指で押す前提で高さを取る。狭い画面では 44px を下回らないように。
              className={`touch-hold flex min-h-11 w-full items-center gap-2.5 rounded px-3 py-3 text-left text-sm transition hover:bg-surface-3 active:bg-surface-3 sm:min-h-0 sm:py-2 ${
                item.danger ? "text-red-300" : "text-ink"
              }`}
            >
              {item.icon && <span className="shrink-0 text-ink-muted">{item.icon}</span>}
              {item.label}
            </button>
          </div>
        ))}
      </div>
    </>,
    document.body,
  );
}
