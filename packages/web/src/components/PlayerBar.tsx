import {
  Heart,
  ListMusic,
  Loader2,
  Monitor,
  Pause,
  Play,
  Repeat,
  Repeat1,
  Shuffle,
  SkipBack,
  SkipForward,
  Volume1,
  Volume2,
  VolumeX,
} from "lucide-react";
import type { CollectionKind, Track } from "@musicshare/shared";
import { Artwork } from "./Artwork.js";
import { ProgressBar } from "./ProgressBar.js";
import { formatDuration } from "../lib/format.js";
import { canControl, usePlayer } from "../lib/player-store.js";
import { useSession } from "../lib/session-store.js";

interface Props {
  onToggleSessionPanel: () => void;
  sessionPanelOpen: boolean;
  /** 再生中の曲名の下から、アーティストのページへ移るための入口。 */
  onOpenCollection?: (kind: CollectionKind, id: string, title: string) => void;
  onToggleQueue: () => void;
  queueOpen: boolean;
}

export function PlayerBar({
  onToggleSessionPanel,
  sessionPanelOpen,
  onOpenCollection,
  onToggleQueue,
  queueOpen,
}: Props) {
  const player = usePlayer();
  const sessionConnected = useSession((s) => s.connected);
  const track = player.current();
  const duration = player.durationMs();
  const controllable = canControl(player);

  return (
    <footer className="shrink-0 border-t border-line bg-base">
      {/* 画面が狭いときは、たたんだ 1 行だけ出す。 */}
      <div className="flex items-center gap-3 px-3 py-2 md:hidden">
        {track ? (
          <>
            <Artwork
              seed={track.id}
              label={track.title}
              src={track.artworkUrl}
              className="size-11"
            />
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium">{track.title}</div>
              <div className="truncate text-xs text-ink-muted">
                <ArtistLink track={track} onOpenCollection={onOpenCollection} />
              </div>
            </div>
            <button
              type="button"
              onClick={player.toggle}
              disabled={!controllable}
              className="grid size-10 shrink-0 place-items-center rounded-full text-ink disabled:opacity-40"
              aria-label={player.playing ? "一時停止" : "再生"}
            >
              {player.loading ? (
                <Loader2 className="size-6 animate-spin" />
              ) : player.playing ? (
                <Pause className="size-6 fill-current" />
              ) : (
                <Play className="size-6 translate-x-px fill-current" />
              )}
            </button>
            <button
              type="button"
              onClick={player.next}
              disabled={!controllable}
              className="grid size-10 shrink-0 place-items-center text-ink disabled:opacity-40"
              aria-label="次の曲"
            >
              <SkipForward className="size-5 fill-current" />
            </button>
          </>
        ) : (
          <div className="py-2 text-sm text-ink-faint">再生していません</div>
        )}
      </div>

      {/* 狭い画面では進捗を細い線だけで見せる。 */}
      <div className="px-3 pb-1 md:hidden">
        <ProgressBar
          value={player.positionMs}
          max={duration}
          onChange={player.seek}
          disabled={!controllable || !track}
        />
      </div>

      {/* 広い画面向け */}
      <div className="hidden h-[88px] items-center justify-between gap-4 px-4 md:flex">
        <div className="flex w-[30%] min-w-0 items-center gap-3">
          {track ? (
            <>
              <Artwork
                seed={track.id}
                label={track.title}
                src={track.artworkUrl}
                className="size-14"
              />
              <div className="min-w-0">
                <div className="truncate text-sm font-medium">{track.title}</div>
                <div className="truncate text-xs text-ink-muted">
                  <ArtistLink track={track} onOpenCollection={onOpenCollection} />
                </div>
              </div>
              <button
                type="button"
                className="ml-2 shrink-0 text-ink-muted transition hover:text-ink"
                aria-label="ライブラリに追加"
              >
                <Heart className="size-4" />
              </button>
            </>
          ) : (
            <div className="text-sm text-ink-faint">再生していません</div>
          )}
        </div>

        <div className="flex max-w-[45%] flex-1 flex-col items-center gap-1.5">
          <div className="flex items-center gap-4">
            <IconToggle
              active={player.shuffle}
              onClick={player.toggleShuffle}
              disabled={!controllable}
              label="シャッフル"
            >
              <Shuffle className="size-4" />
            </IconToggle>

            <button
              type="button"
              onClick={player.prev}
              disabled={!controllable}
              className="text-ink-muted transition hover:text-ink disabled:opacity-40"
              aria-label="前の曲"
            >
              <SkipBack className="size-5 fill-current" />
            </button>

            <button
              type="button"
              onClick={player.toggle}
              disabled={!controllable || !track}
              className="grid size-8 place-items-center rounded-full bg-ink text-base transition hover:scale-105 disabled:opacity-40 disabled:hover:scale-100"
              aria-label={player.playing ? "一時停止" : "再生"}
            >
              {player.loading ? (
                <Loader2 className="size-4 animate-spin" />
              ) : player.playing ? (
                <Pause className="size-4 fill-current" />
              ) : (
                <Play className="size-4 translate-x-px fill-current" />
              )}
            </button>

            <button
              type="button"
              onClick={player.next}
              disabled={!controllable}
              className="text-ink-muted transition hover:text-ink disabled:opacity-40"
              aria-label="次の曲"
            >
              <SkipForward className="size-5 fill-current" />
            </button>

            <IconToggle
              active={player.repeat !== "off"}
              onClick={player.cycleRepeat}
              disabled={!controllable}
              label="リピート"
            >
              {player.repeat === "one" ? (
                <Repeat1 className="size-4" />
              ) : (
                <Repeat className="size-4" />
              )}
            </IconToggle>
          </div>

          <div className="flex w-full items-center gap-2">
            <span className="w-10 text-right text-[11px] tabular-nums text-ink-muted">
              {formatDuration(player.positionMs)}
            </span>
            <ProgressBar
              value={player.positionMs}
              max={duration}
              onChange={player.seek}
              disabled={!controllable || !track}
              className="flex-1"
            />
            <span className="w-10 text-[11px] tabular-nums text-ink-muted">
              {formatDuration(duration)}
            </span>
          </div>
        </div>

        <div className="flex w-[30%] items-center justify-end gap-3">
          <button
            type="button"
            onClick={onToggleSessionPanel}
            className={`flex items-center gap-1.5 rounded-full px-2.5 py-1.5 text-xs font-medium transition ${
              sessionPanelOpen || sessionConnected
                ? "bg-accent/15 text-accent"
                : "text-ink-muted hover:text-ink"
            }`}
          >
            <Monitor className="size-4" />
            一緒に聴く
          </button>

          <button
            type="button"
            onClick={onToggleQueue}
            className={`transition ${queueOpen ? "text-accent" : "text-ink-muted hover:text-ink"}`}
            aria-label="再生キュー"
          >
            <ListMusic className="size-4" />
          </button>

          <div className="flex w-32 items-center gap-2">
            <button
              type="button"
              onClick={player.toggleMute}
              className="text-ink-muted transition hover:text-ink"
              aria-label="ミュート"
            >
              {player.muted || player.volume === 0 ? (
                <VolumeX className="size-4" />
              ) : player.volume < 0.5 ? (
                <Volume1 className="size-4" />
              ) : (
                <Volume2 className="size-4" />
              )}
            </button>
            <ProgressBar
              value={player.muted ? 0 : player.volume}
              max={1}
              onChange={player.setVolume}
              className="flex-1"
            />
          </div>
        </div>
      </div>
    </footer>
  );
}

/** 再生中の曲のアーティスト名。移動先が分かる場合だけ押せるようにする。 */
function ArtistLink({
  track,
  onOpenCollection,
}: {
  track: Track;
  onOpenCollection?: (kind: CollectionKind, id: string, title: string) => void;
}) {
  if (!track.artistId || !onOpenCollection) return <>{track.artist}</>;
  return (
    <button
      type="button"
      onClick={() => onOpenCollection("artist", track.artistId!, track.artist)}
      className="truncate transition hover:text-ink hover:underline"
    >
      {track.artist}
    </button>
  );
}

function IconToggle({
  active,
  onClick,
  disabled,
  label,
  children,
}: {
  active: boolean;
  onClick: () => void;
  disabled?: boolean;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className={`relative transition disabled:opacity-40 ${
        active ? "text-accent" : "text-ink-muted hover:text-ink"
      }`}
    >
      {children}
      {active && (
        <span className="absolute -bottom-1.5 left-1/2 size-1 -translate-x-1/2 rounded-full bg-accent" />
      )}
    </button>
  );
}
