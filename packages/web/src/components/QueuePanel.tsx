import { useRef, useState } from "react";
import { GripVertical, ListMusic, Volume2, X } from "lucide-react";
import type { Track } from "@sharetify/shared";
import { Artwork } from "./Artwork.js";
import { formatDuration } from "../lib/format.js";
import { usePlayer } from "../lib/player-store.js";
import { useSwipeAway, useSwipeToDismiss } from "../lib/touch.js";

interface Props {
  onClose: () => void;
  fullWidth?: boolean;
}

/**
 * これから流れる曲の一覧。
 *
 * 押せばそこへ飛べる。要らないものは取り除けるし、順番も変えられる。
 * 取り除き方は場面で分けてある。指しかない端末では横へ払う。
 * 狙って押す小さな印より、払う動きのほうが外さない。
 */
export function QueuePanel({ onClose, fullWidth = false }: Props) {
  const queue = usePlayer((s) => s.queue);
  const index = usePlayer((s) => s.index);
  const playing = usePlayer((s) => s.playing);
  const playQueue = usePlayer((s) => s.playQueue);
  const removeFromQueue = usePlayer((s) => s.removeFromQueue);
  const moveInQueue = usePlayer((s) => s.moveInQueue);
  // 覆いかぶさっているときは、下へ払って閉じられる。
  const dismiss = useSwipeToDismiss(onClose);

  /** いま掴んでいる行。掴んでいなければ null。 */
  const [dragging, setDragging] = useState<number | null>(null);
  /** 落とし先として印を出している行。 */
  const [over, setOver] = useState<number | null>(null);

  const upcoming = queue.slice(index + 1);

  const drop = (to: number) => {
    if (dragging !== null && dragging !== to) moveInQueue(dragging, to);
    setDragging(null);
    setOver(null);
  };

  return (
    <aside
      ref={fullWidth ? dismiss.ref : undefined}
      {...(fullWidth ? dismiss.bind : {})}
      className={`flex h-full shrink-0 flex-col rounded-lg bg-surface ${
        fullWidth ? "sheet-drag w-full" : "w-[320px]"
      }`}
    >
      {/* 覆いかぶさっているときは、下へ払って閉じられる。 */}
      {fullWidth && (
        <div className="flex justify-center pt-2">
          <span className="h-1 w-10 rounded-full bg-ink/20" />
        </div>
      )}
      <header className="flex items-center justify-between px-4 py-3">
        <div className="flex items-center gap-2">
          <ListMusic className="size-4 text-ink-muted" />
          <span className="text-sm font-semibold">再生キュー</span>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="text-ink-muted transition hover:text-ink"
          aria-label="閉じる"
        >
          <X className="size-4" />
        </button>
      </header>

      {queue.length === 0 ? (
        <div className="flex flex-1 items-center justify-center px-6 text-center text-sm text-ink-faint">
          まだ何も入っていません。
        </div>
      ) : (
        <div className="scroll-area min-h-0 flex-1 px-2 pb-2">
          <div className="mt-2">
            <div className="px-2 pb-1 text-xs font-semibold text-ink-faint">再生中</div>
            <QueueRow
              track={queue[index]!}
              at={index}
              current
              playing={playing}
              onJump={() => playQueue(queue, index)}
              onRemove={() => removeFromQueue(index)}
            />
          </div>

          {upcoming.length > 0 && (
            <div className="mt-2">
              <div className="flex items-baseline justify-between px-2 pb-1">
                <span className="text-xs font-semibold text-ink-faint">次に流れる</span>
                {/* どうすれば動かせるのか、一度も触る前に分かるようにしておく。 */}
                <span className="hidden text-[10px] text-ink-faint sm:inline">
                  掴んで並べ替え
                </span>
                <span className="text-[10px] text-ink-faint sm:hidden">払って取り除く</span>
              </div>

              {upcoming.map((track, i) => {
                const at = index + 1 + i;
                return (
                  <QueueRow
                    key={`${track.id}-${at}`}
                    track={track}
                    at={at}
                    draggable
                    dragging={dragging === at}
                    over={over === at}
                    onJump={() => playQueue(queue, at)}
                    onRemove={() => removeFromQueue(at)}
                    onDragStart={() => setDragging(at)}
                    onDragOver={() => setOver(at)}
                    onDrop={() => drop(at)}
                    onDragEnd={() => {
                      setDragging(null);
                      setOver(null);
                    }}
                  />
                );
              })}
            </div>
          )}
        </div>
      )}
    </aside>
  );
}

function QueueRow({
  track,
  at,
  current = false,
  playing = false,
  draggable = false,
  dragging = false,
  over = false,
  onJump,
  onRemove,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
}: {
  track: Track;
  at: number;
  current?: boolean;
  playing?: boolean;
  draggable?: boolean;
  dragging?: boolean;
  over?: boolean;
  onJump: () => void;
  onRemove: () => void;
  onDragStart?: () => void;
  onDragOver?: () => void;
  onDrop?: () => void;
  onDragEnd?: () => void;
}) {
  const swipe = useSwipeAway(onRemove);
  /*
   * 掴んで動かした直後の押下を飲む。
   *
   * 離した場所で押したことになると、並べ替えたつもりが
   * その曲へ飛んでしまう。
   */
  const moved = useRef(false);

  return (
    <div
      ref={swipe.ref}
      {...swipe.bind}
      draggable={draggable}
      onDragStart={(event) => {
        moved.current = true;
        // 何も持たせないと、環境によっては掴んだ判定にならない。
        event.dataTransfer.setData("text/plain", String(at));
        event.dataTransfer.effectAllowed = "move";
        onDragStart?.();
      }}
      onDragOver={(event) => {
        if (!draggable) return;
        // 既定の動きを止めないと、落とせる場所として扱われない。
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        onDragOver?.();
      }}
      onDrop={(event) => {
        event.preventDefault();
        onDrop?.();
      }}
      onDragEnd={() => {
        onDragEnd?.();
        // 離したあとの押下だけを飲みたいので、すぐに戻す。
        setTimeout(() => {
          moved.current = false;
        }, 0);
      }}
      className={`group flex w-full items-center gap-3 rounded-md p-2 text-left transition ${
        dragging ? "opacity-40" : "hover:bg-surface-2"
      } ${over && !dragging ? "ring-1 ring-accent/50" : ""}`}
    >
      {/* 掴む場所。指しかない端末では出さない。そちらは払って取り除く。 */}
      {draggable && (
        <span className="hidden shrink-0 cursor-grab text-ink-faint opacity-0 transition group-hover:opacity-100 active:cursor-grabbing sm:block">
          <GripVertical className="size-4" />
        </span>
      )}

      <button
        type="button"
        onClick={() => {
          if (moved.current) return;
          onJump();
        }}
        className="flex min-w-0 flex-1 items-center gap-3 text-left"
      >
        <Artwork seed={track.id} label={track.title} src={track.artworkUrl} className="size-10" />
        <span className="min-w-0 flex-1">
          <span className={`block truncate text-sm ${current ? "text-accent" : "text-ink"}`}>
            {track.title}
          </span>
          <span className="block truncate text-xs text-ink-muted">{track.artist}</span>
        </span>
      </button>

      {current && playing ? (
        <Volume2 className="size-4 shrink-0 text-accent" />
      ) : (
        <span className="shrink-0 text-xs tabular-nums text-ink-faint group-hover:hidden sm:group-hover:hidden">
          {formatDuration(track.durationMs)}
        </span>
      )}

      {/*
        取り除く印。
        場所を取らないよう、触れている間だけ長さと入れ替えて出す。
      */}
      <button
        type="button"
        onClick={onRemove}
        aria-label={`${track.title} を取り除く`}
        className="hidden shrink-0 text-ink-faint transition hover:text-ink group-hover:block"
      >
        <X className="size-4" />
      </button>
    </div>
  );
}
