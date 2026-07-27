import { useRef } from "react";
import { Clock3, Download, Play, Plus, Volume2, X } from "lucide-react";
import type { CacheState, CollectionKind, Track } from "@sharetify/shared";
import { Artwork } from "./Artwork.js";
import { formatDuration } from "../lib/format.js";
import { usePlayer } from "../lib/player-store.js";
import { useLongPress } from "../lib/touch.js";
import { trackMenuItems, type TrackMenuHandlers, useContextMenu } from "../lib/track-menu.js";

interface Props {
  tracks: Track[];
  /** 曲ごとのオフライン状態。DL 済みかどうかを行に出す。 */
  cacheStates?: Record<string, CacheState>;
  onPlay: (index: number) => void;
  showAlbum?: boolean;
  /** アーティスト名やアルバム名から、そのページへ移るための入口。 */
  onOpenCollection?: (kind: CollectionKind, id: string, title: string) => void;
  /** プレイリストへ入れる。渡されたときだけ行に出す。 */
  onAddTo?: (track: Track) => void;
  /** このプレイリストから外す。渡されたときだけ行に出す。 */
  onRemove?: (trackId: string) => void;
}

export function TrackList({
  tracks,
  cacheStates = {},
  onPlay,
  showAlbum = true,
  onOpenCollection,
  onAddTo,
  onRemove,
}: Props) {
  const currentId = usePlayer((s) => s.current()?.id);
  const playing = usePlayer((s) => s.playing);

  // 右クリックの品書き。中身の組み立ては札の画面と共通のものを使う。
  const menu = useContextMenu();

  /*
   * 指で押し続けたときも同じ品書きを出す。
   * 右ボタンの無い端末では、これが唯一の入口になる。
   */
  const handlersFor = (track: Track, index: number): TrackMenuHandlers => ({
    onPlay: () => onPlay(index),
    ...(onAddTo ? { onAddTo } : {}),
    ...(onRemove ? { onRemove } : {}),
    ...(onOpenCollection ? { onOpenCollection } : {}),
  });

  const pressed = useRef<{ track: Track; index: number } | null>(null);
  const longPress = useLongPress((x, y) => {
    const target = pressed.current;
    if (!target) return;
    menu.openAt(x, y, trackMenuItems(target.track, handlersFor(target.track, target.index)));
  });

  // 狭い画面ではアルバム列を落とす。曲名とアーティストが読めれば足りる。
  const grid = showAlbum
    ? "grid-cols-[16px_1fr_auto] md:grid-cols-[16px_4fr_3fr_minmax(80px,1fr)]"
    : "grid-cols-[16px_1fr_auto] md:grid-cols-[16px_1fr_minmax(80px,1fr)]";

  return (
    <div>
      <div
        className={`grid gap-4 border-b border-line px-2 pb-2 text-xs text-ink-muted sm:px-4 ${grid}`}
      >
        <span className="text-right">#</span>
        <span>タイトル</span>
        {showAlbum && <span className="hidden md:block">アルバム</span>}
        <span className="flex justify-end pr-2">
          <Clock3 className="size-4" />
        </span>
      </div>

      <div className="pt-2">
        {tracks.map((track, index) => {
          const isCurrent = track.id === currentId;
          const cache = cacheStates[track.id] ?? "none";
          return (
            /*
             * 行そのものを押すと再生する。
             * 中にアーティストやアルバムへの入口を置くので、
             * 押せる要素を入れ子にしないよう役割で表している。
             */
            <div
              key={`${track.id}-${index}`}
              role="button"
              tabIndex={0}
              onClick={() => onPlay(index)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onPlay(index);
                }
              }}
              onContextMenu={(event) =>
                menu.open(event, trackMenuItems(track, handlersFor(track, index)))
              }
              {...longPress}
              onTouchStart={(event) => {
                // どの行を押しているかを控えてから、長押しの計測を始める。
                pressed.current = { track, index };
                longPress.onTouchStart(event);
              }}
              className={`row-hover press touch-hold group grid cursor-pointer items-center gap-4 rounded-md px-2 py-2 text-left transition hover:bg-surface-2 sm:px-4 ${grid}`}
            >
              <div className="relative flex justify-end">
                {isCurrent && playing ? (
                  <Volume2 className="size-4 text-accent" />
                ) : (
                  <span
                    className={`row-index text-sm tabular-nums transition ${
                      isCurrent ? "text-accent" : "text-ink-muted"
                    }`}
                  >
                    {index + 1}
                  </span>
                )}
                <span className="row-play pointer-events-none absolute inset-0 hidden place-items-center opacity-0 transition md:grid">
                  <Play className="size-4 fill-current" />
                </span>
              </div>

              <div className="flex min-w-0 items-center gap-3">
                <Artwork
                  seed={track.id}
                  label={track.title}
                  src={track.artworkUrl}
                  className="size-10"
                />
                <div className="min-w-0">
                  <div className={`truncate text-sm ${isCurrent ? "text-accent" : "text-ink"}`}>
                    {track.title}
                  </div>
                  <div className="truncate text-xs text-ink-muted">
                    <LinkedName
                      label={track.artist}
                      onOpen={
                        track.artistId && onOpenCollection
                          ? () => onOpenCollection("artist", track.artistId!, track.artist)
                          : undefined
                      }
                    />
                  </div>
                </div>
              </div>

              {showAlbum && (
                <span className="hidden truncate text-sm text-ink-muted md:block">
                  {track.album ? (
                    <LinkedName
                      label={track.album}
                      onOpen={
                        track.albumId && onOpenCollection
                          ? () => onOpenCollection("album", track.albumId!, track.album!)
                          : undefined
                      }
                    />
                  ) : (
                    "—"
                  )}
                </span>
              )}

              <div className="flex items-center justify-end gap-2 pr-2 sm:gap-3">
                <CacheBadge state={cache} />
                {onAddTo && (
                  <RowAction
                    label="プレイリストに追加"
                    onClick={() => onAddTo(track)}
                    icon={<Plus className="size-4" />}
                  />
                )}
                {onRemove && (
                  <RowAction
                    label="このプレイリストから外す"
                    onClick={() => onRemove(track.id)}
                    icon={<X className="size-4" />}
                  />
                )}
                <span className="text-sm tabular-nums text-ink-muted">
                  {formatDuration(track.durationMs)}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {menu.node}
    </div>
  );
}

/** 行の中に置く小さな操作。行そのものの再生と取り違えないよう伝播を止める。 */
function RowAction({
  label,
  onClick,
  icon,
}: {
  label: string;
  onClick: () => void;
  icon: React.ReactNode;
}) {
  return (
    <span
      role="button"
      tabIndex={0}
      aria-label={label}
      title={label}
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
      onKeyDown={(event) => {
        if (event.key !== "Enter") return;
        event.stopPropagation();
        event.preventDefault();
        onClick();
      }}
      className="cursor-pointer text-ink-faint transition hover:text-ink"
    >
      {icon}
    </span>
  );
}

/**
 * 移動先がある名前は押せるようにする。
 * 行の再生と取り違えないよう、ここで伝播を止める。
 */
function LinkedName({ label, onOpen }: { label: string; onOpen?: () => void }) {
  if (!onOpen) return <>{label}</>;
  return (
    <span
      role="link"
      tabIndex={0}
      onClick={(event) => {
        event.stopPropagation();
        onOpen();
      }}
      onKeyDown={(event) => {
        if (event.key !== "Enter") return;
        event.stopPropagation();
        event.preventDefault();
        onOpen();
      }}
      className="cursor-pointer hover:text-ink hover:underline"
    >
      {label}
    </span>
  );
}

/**
 * オフライン状態のバッジ。
 *
 * この構成では PC が落ちていると DL 済みの曲しか鳴らせないので、
 * 「どれが手元にあるか」は常に見えていないと困る。
 */
function CacheBadge({ state }: { state: CacheState }) {
  if (state === "ready") {
    return (
      <span
        className="grid size-4 place-items-center rounded-full bg-accent text-accent-ink"
        title="オフラインで再生できる"
      >
        <Download className="size-2.5" />
      </span>
    );
  }
  if (state === "downloading" || state === "queued") {
    return (
      <span
        className="size-4 animate-pulse rounded-full border border-ink-faint"
        title="ダウンロード中"
      />
    );
  }
  if (state === "failed") {
    return (
      <span className="text-xs text-red-400" title="取得に失敗">
        !
      </span>
    );
  }
  return null;
}
