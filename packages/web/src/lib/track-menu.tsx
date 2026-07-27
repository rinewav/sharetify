import { useCallback, useState } from "react";
import {
  CornerUpRight,
  Disc3,
  ListPlus,
  ListMusic,
  Play,
  Plus,
  User,
  UserMinus,
  UserPlus,
  X,
} from "lucide-react";
import type { CollectionKind, Track } from "@musicshare/shared";
import { ContextMenu, type MenuItem } from "../components/ContextMenu.js";
import { useLibrary } from "./library-store.js";
import { usePlayer } from "./player-store.js";

/**
 * 右クリックの品書きを、置き場所によらず同じ形で出すための道具。
 *
 * 一覧の行にだけ書いていたので、札で並ぶ画面では何も出なかった。
 * 品書きの中身を組む所を一箇所にまとめ、どの画面からも同じ手順で呼べるようにする。
 */

interface OpenState {
  x: number;
  y: number;
  items: MenuItem[];
}

export function useContextMenu() {
  const [state, setState] = useState<OpenState | null>(null);

  const open = useCallback((event: React.MouseEvent, items: MenuItem[]) => {
    if (items.length === 0) return;
    event.preventDefault();
    // 入れ子になっている所では、外側の品書きまで開いてしまわないように止める。
    event.stopPropagation();
    setState({ x: event.clientX, y: event.clientY, items });
  }, []);

  const close = useCallback(() => setState(null), []);

  const node = state ? (
    <ContextMenu x={state.x} y={state.y} items={state.items} onClose={close} />
  ) : null;

  return { open, node, close };
}

export interface TrackMenuHandlers {
  /** その場で鳴らす。渡されないときは品書きに出さない。 */
  onPlay?: () => void;
  onAddTo?: (track: Track) => void;
  onRemove?: (trackId: string) => void;
  onOpenCollection?: (kind: CollectionKind, id: string, title: string) => void;
}

/** 曲に対して出す品書き。 */
export function trackMenuItems(track: Track, handlers: TrackMenuHandlers = {}): MenuItem[] {
  const { playNext, enqueue } = usePlayer.getState();
  const items: MenuItem[] = [];

  if (handlers.onPlay) {
    items.push({ label: "再生", icon: <Play className="size-4" />, onSelect: handlers.onPlay });
  }

  items.push(
    {
      label: "次に再生",
      icon: <CornerUpRight className="size-4" />,
      onSelect: () => playNext(track),
    },
    {
      label: "最後に追加",
      icon: <ListPlus className="size-4" />,
      onSelect: () => enqueue(track),
    },
  );

  const { onAddTo, onOpenCollection, onRemove } = handlers;

  if (onAddTo) {
    items.push({
      label: "プレイリストに追加",
      icon: <Plus className="size-4" />,
      onSelect: () => onAddTo(track),
      separated: true,
    });
  }

  if (track.artistId && onOpenCollection) {
    items.push({
      label: "アーティストを開く",
      icon: <User className="size-4" />,
      onSelect: () => onOpenCollection("artist", track.artistId!, track.artist),
      separated: !onAddTo,
    });
  }

  if (track.albumId && track.album && onOpenCollection) {
    items.push({
      label: "アルバムを開く",
      icon: <Disc3 className="size-4" />,
      onSelect: () => onOpenCollection("album", track.albumId!, track.album!),
    });
  }

  if (onRemove) {
    items.push({
      label: "このプレイリストから外す",
      icon: <X className="size-4" />,
      onSelect: () => onRemove(track.id),
      separated: true,
      danger: true,
    });
  }

  return items;
}

export interface CollectionMenuTarget {
  kind: CollectionKind;
  id: string;
  title: string;
  artworkUrl?: string;
  onOpen: () => void;
  /** 開かずにその場で流す。取得が要るので呼び出し側に任せる。 */
  onPlay?: () => void;
}

/**
 * アルバム・プレイリスト・アーティストの札に出す品書き。
 *
 * フォローの有無で文言が変わるので、書棚の状態を見る必要がある。
 * だから素の関数ではなく、ここだけフックにしている。
 */
export function useCollectionMenuItems(): (target: CollectionMenuTarget) => MenuItem[] {
  const follows = useLibrary((s) => s.follows);
  const follow = useLibrary((s) => s.follow);
  const unfollow = useLibrary((s) => s.unfollow);

  return useCallback(
    (target) => {
      const items: MenuItem[] = [];

      if (target.onPlay) {
        items.push({
          label: "再生",
          icon: <Play className="size-4" />,
          onSelect: target.onPlay,
        });
      }

      items.push({
        label: labelForOpen(target.kind),
        icon: iconForOpen(target.kind),
        onSelect: target.onOpen,
        separated: Boolean(target.onPlay),
      });

      if (target.kind === "artist") {
        const following = follows.some((a) => a.id === target.id);
        items.push({
          label: following ? "フォローを外す" : "フォローする",
          icon: following ? <UserMinus className="size-4" /> : <UserPlus className="size-4" />,
          onSelect: () => {
            if (following) void unfollow(target.id);
            else
              void follow({
                id: target.id,
                name: target.title,
                ...(target.artworkUrl ? { artworkUrl: target.artworkUrl } : {}),
              });
          },
          separated: true,
        });
      }

      return items;
    },
    [follows, follow, unfollow],
  );
}

function labelForOpen(kind: CollectionKind): string {
  if (kind === "artist") return "アーティストを開く";
  if (kind === "album") return "アルバムを開く";
  return "プレイリストを開く";
}

function iconForOpen(kind: CollectionKind): React.ReactNode {
  if (kind === "artist") return <User className="size-4" />;
  if (kind === "album") return <Disc3 className="size-4" />;
  return <ListMusic className="size-4" />;
}
