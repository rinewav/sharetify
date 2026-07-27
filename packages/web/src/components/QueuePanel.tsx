import { ListMusic, Volume2, X } from "lucide-react";
import { Artwork } from "./Artwork.js";
import { formatDuration } from "../lib/format.js";
import { usePlayer } from "../lib/player-store.js";
import { useSwipeToDismiss } from "../lib/touch.js";

interface Props {
  onClose: () => void;
  fullWidth?: boolean;
}

/** これから流れる曲の一覧。押せばそこへ飛べる。 */
export function QueuePanel({ onClose, fullWidth = false }: Props) {
  const queue = usePlayer((s) => s.queue);
  const index = usePlayer((s) => s.index);
  const playing = usePlayer((s) => s.playing);
  const playQueue = usePlayer((s) => s.playQueue);
  // 覆いかぶさっているときは、下へ払って閉じられる。
  const dismiss = useSwipeToDismiss(onClose);

  const upcoming = queue.slice(index + 1);

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
          <Row
            label="再生中"
            tracks={queue.slice(index, index + 1)}
            offset={index}
            current
            playing={playing}
            onJump={(i) => playQueue(queue, i)}
          />
          {upcoming.length > 0 && (
            <Row
              label="次に流れる"
              tracks={upcoming}
              offset={index + 1}
              onJump={(i) => playQueue(queue, i)}
            />
          )}
        </div>
      )}
    </aside>
  );
}

function Row({
  label,
  tracks,
  offset,
  current = false,
  playing = false,
  onJump,
}: {
  label: string;
  tracks: ReturnType<typeof usePlayer.getState>["queue"];
  offset: number;
  current?: boolean;
  playing?: boolean;
  onJump: (index: number) => void;
}) {
  return (
    <div className="mt-2">
      <div className="px-2 pb-1 text-xs font-semibold text-ink-faint">{label}</div>
      {tracks.map((track, i) => (
        <button
          key={`${track.id}-${offset + i}`}
          type="button"
          onClick={() => onJump(offset + i)}
          className="flex w-full items-center gap-3 rounded-md p-2 text-left transition hover:bg-surface-2"
        >
          <Artwork seed={track.id} label={track.title} src={track.artworkUrl} className="size-10" />
          <div className="min-w-0 flex-1">
            <div className={`truncate text-sm ${current ? "text-accent" : "text-ink"}`}>
              {track.title}
            </div>
            <div className="truncate text-xs text-ink-muted">{track.artist}</div>
          </div>
          {current && playing ? (
            <Volume2 className="size-4 shrink-0 text-accent" />
          ) : (
            <span className="shrink-0 text-xs tabular-nums text-ink-faint">
              {formatDuration(track.durationMs)}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}
