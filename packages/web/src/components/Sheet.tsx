import { useRef } from "react";
import { useSwipeToDismiss } from "../lib/touch.js";

interface Props {
  onClose: () => void;
  /** 閉じられない場面では、払っても背景を押しても閉じない。 */
  dismissible?: boolean;
  /** 中身の高さを抑えたいときに渡す。 */
  className?: string;
  children: React.ReactNode;
}

/**
 * 下からせり出す小窓。
 *
 * 指で下へ払えば閉じる。背景を押しても閉じる。
 * 閉じ方が一つしかないと、画面の端まで指を運ばされることになる。
 */
export function Sheet({ onClose, dismissible = true, className = "", children }: Props) {
  const backdrop = useRef<HTMLDivElement>(null);
  const dismiss = useSwipeToDismiss(onClose, { backdrop });

  return (
    <div
      ref={backdrop}
      onClick={dismissible ? onClose : undefined}
      className="animate-fade fixed inset-0 z-30 flex items-end justify-center bg-black/70 p-3 sm:items-center"
    >
      <div
        ref={dismissible ? dismiss.ref : undefined}
        {...(dismissible ? dismiss.bind : {})}
        // 中身を押したときに、背景を押した扱いにしない。
        onClick={(event) => event.stopPropagation()}
        className={`animate-slide-up sheet-drag flex w-full flex-col rounded-2xl bg-surface p-5 shadow-2xl ${className}`}
      >
        {/* 掴んで下ろせることを示す取っ手。 */}
        {dismissible && (
          <div className="mb-3 flex justify-center sm:hidden">
            <span className="h-1 w-10 rounded-full bg-ink/20" />
          </div>
        )}
        {children}
      </div>
    </div>
  );
}
