import { Play } from "lucide-react";
import { Artwork } from "./Artwork.js";
import { LinkedName } from "./LinkedName.js";
import type { MenuItem } from "./ContextMenu.js";
import { PressableCard } from "./PressableCard.js";

interface Props {
  seed: string;
  title: string;
  subtitle?: string;
  artworkUrl?: string;
  /** アーティストは丸く出す。 */
  round?: boolean;
  onOpen: () => void;
  onPlay?: () => void;
  /**
   * 副題の演奏者を押したときの行き先。
   *
   * 札そのものを押すと曲が鳴るが、名前を見て「この人の他の曲」へ
   * 行きたくなることがある。名前だけは別の行き先にしておく。
   */
  onOpenSubtitle?: () => void;
  /** 右ボタンでも指で押し続けても出す品書き。 */
  menuItems?: () => MenuItem[];
  onOpenMenu?: (x: number, y: number, items: MenuItem[]) => void;
}

/** 検索結果の「開けるもの」を並べるための札。 */
export function ResultCard({
  seed,
  title,
  subtitle,
  artworkUrl,
  round = false,
  onOpen,
  onPlay,
  onOpenSubtitle,
  menuItems,
  onOpenMenu,
}: Props) {
  return (
    <PressableCard
      onClick={onOpen}
      {...(menuItems ? { menuItems } : {})}
      {...(onOpenMenu ? { onOpenMenu } : {})}
      className="press group relative min-w-0 rounded-lg bg-surface p-3 text-left transition hover:bg-surface-3 sm:p-4"
    >
      <div className="relative">
        <Artwork
          seed={seed}
          label={title}
          src={artworkUrl}
          className="aspect-square w-full text-4xl sm:text-5xl"
          rounded={round ? "rounded-full" : "rounded-md"}
        />
        {onPlay && (
          <span
            onClick={(event) => {
              event.stopPropagation();
              onPlay();
            }}
            className="absolute right-2 bottom-2 grid size-10 translate-y-2 place-items-center rounded-full bg-accent text-accent-ink opacity-0 shadow-xl transition group-hover:translate-y-0 group-hover:opacity-100 sm:size-11"
          >
            <Play className="size-4 translate-x-px fill-current" />
          </span>
        )}
      </div>
      <div className="mt-3 truncate text-sm font-semibold">{title}</div>
      {subtitle && (
        <div className="mt-1 truncate text-xs text-ink-muted">
          <LinkedName label={subtitle} {...(onOpenSubtitle ? { onOpen: onOpenSubtitle } : {})} />
        </div>
      )}
    </PressableCard>
  );
}
