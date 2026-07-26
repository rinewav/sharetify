import { Clock3, Download, Play, Volume2 } from "lucide-react";
import type { Track } from "@musicshare/shared";
import type { CacheState } from "@musicshare/shared";
import { Artwork } from "./Artwork.js";
import { formatDuration } from "../lib/format.js";
import { usePlayer } from "../lib/player-store.js";

interface Props {
  tracks: Track[];
  /** 曲ごとのオフライン状態。DL 済みかどうかを行に出す。 */
  cacheStates?: Record<string, CacheState>;
  onPlay: (index: number) => void;
  showAlbum?: boolean;
}

export function TrackList({ tracks, cacheStates = {}, onPlay, showAlbum = true }: Props) {
  const currentId = usePlayer((s) => s.current()?.id);
  const playing = usePlayer((s) => s.playing);

  return (
    <div>
      <div
        className={`grid gap-4 border-b border-line px-4 pb-2 text-xs text-ink-muted ${
          showAlbum ? "grid-cols-[16px_4fr_3fr_minmax(80px,1fr)]" : "grid-cols-[16px_1fr_minmax(80px,1fr)]"
        }`}
      >
        <span className="text-right">#</span>
        <span>タイトル</span>
        {showAlbum && <span>アルバム</span>}
        <span className="flex justify-end pr-2">
          <Clock3 className="size-4" />
        </span>
      </div>

      <div className="pt-2">
        {tracks.map((track, index) => {
          const isCurrent = track.id === currentId;
          const cache = cacheStates[track.id] ?? "none";
          return (
            <div
              key={`${track.id}-${index}`}
              onDoubleClick={() => onPlay(index)}
              className={`row-hover group grid items-center gap-4 rounded-md px-4 py-2 transition hover:bg-surface-2 ${
                showAlbum
                  ? "grid-cols-[16px_4fr_3fr_minmax(80px,1fr)]"
                  : "grid-cols-[16px_1fr_minmax(80px,1fr)]"
              }`}
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
                <button
                  type="button"
                  onClick={() => onPlay(index)}
                  className="row-play absolute inset-0 grid place-items-center opacity-0 transition"
                  aria-label={`${track.title} を再生`}
                >
                  <Play className="size-4 fill-current" />
                </button>
              </div>

              <div className="flex min-w-0 items-center gap-3">
                <Artwork seed={track.id} label={track.title} className="size-10" />
                <div className="min-w-0">
                  <div
                    className={`truncate text-sm ${isCurrent ? "text-accent" : "text-ink"}`}
                  >
                    {track.title}
                  </div>
                  <div className="truncate text-xs text-ink-muted">{track.artist}</div>
                </div>
              </div>

              {showAlbum && (
                <span className="truncate text-sm text-ink-muted">{track.album ?? "—"}</span>
              )}

              <div className="flex items-center justify-end gap-3 pr-2">
                <CacheBadge state={cache} />
                <span className="text-sm tabular-nums text-ink-muted">
                  {formatDuration(track.durationMs)}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
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
    return <span className="text-xs text-red-400" title="取得に失敗">!</span>;
  }
  return null;
}
