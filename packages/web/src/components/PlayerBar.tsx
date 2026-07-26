import {
  Heart,
  ListMusic,
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
import { Artwork } from "./Artwork.js";
import { ProgressBar } from "./ProgressBar.js";
import { formatDuration } from "../lib/format.js";
import { canControl, usePlayer } from "../lib/player-store.js";
import { useSession } from "../lib/session-store.js";

interface Props {
  onToggleSessionPanel: () => void;
  sessionPanelOpen: boolean;
}

export function PlayerBar({ onToggleSessionPanel, sessionPanelOpen }: Props) {
  const player = usePlayer();
  const sessionConnected = useSession((s) => s.connected);
  const track = player.current();
  const duration = player.durationMs();
  const controllable = canControl(player);

  return (
    <footer className="flex h-[88px] shrink-0 items-center justify-between gap-4 border-t border-line bg-base px-4">
      {/* いま鳴っているもの */}
      <div className="flex w-[30%] min-w-0 items-center gap-3">
        {track ? (
          <>
            <Artwork seed={track.id} label={track.title} className="size-14" />
            <div className="min-w-0">
              <div className="truncate text-sm font-medium">{track.title}</div>
              <div className="truncate text-xs text-ink-muted">{track.artist}</div>
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

      {/* 再生コントロール */}
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
            {player.playing ? (
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

      {/* 右側のユーティリティ */}
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
          className="text-ink-muted transition hover:text-ink"
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
    </footer>
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
