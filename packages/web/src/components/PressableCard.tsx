import type { MenuItem } from "./ContextMenu.js";
import { useLongPress } from "../lib/touch.js";

interface Props {
  /** 押したとき。 */
  onClick: () => void;
  /** 出す品書き。無ければ長押ししても何も起きない。 */
  menuItems?: () => MenuItem[];
  onOpenMenu?: (x: number, y: number, items: MenuItem[]) => void;
  className?: string;
  children: React.ReactNode;
}

/**
 * 押せる札。
 *
 * 右ボタンでも、指で押し続けても、同じ品書きが出る。
 * 札を出す画面ごとに配線し直すと置き忘れが出るので、ここにまとめる。
 */
export function PressableCard({ onClick, menuItems, onOpenMenu, className = "", children }: Props) {
  const openMenu = (x: number, y: number) => {
    if (!menuItems || !onOpenMenu) return;
    onOpenMenu(x, y, menuItems());
  };

  const longPress = useLongPress(openMenu, Boolean(menuItems && onOpenMenu));

  return (
    <button
      type="button"
      onClick={onClick}
      onContextMenu={(event) => {
        if (!menuItems || !onOpenMenu) return;
        event.preventDefault();
        event.stopPropagation();
        openMenu(event.clientX, event.clientY);
      }}
      {...longPress}
      className={`touch-hold ${className}`}
    >
      {children}
    </button>
  );
}
