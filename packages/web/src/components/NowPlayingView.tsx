import { useState } from "react";
import {
  ChevronDown,
  Heart,
  ListMusic,
  Mic2,
  Pause,
  Play,
  Repeat,
  Repeat1,
  Shuffle,
  SkipBack,
  SkipForward,
} from "lucide-react";
import type { CollectionKind } from "@sharetify/shared";
import { Artwork } from "./Artwork.js";
import { LyricsPane } from "./LyricsPane.js";
import { ProgressBar } from "./ProgressBar.js";
import { artworkGradient } from "../lib/artwork.js";
import { useSwipeToDismiss } from "../lib/touch.js";
import { formatDuration } from "../lib/format.js";
import { useLibrary } from "../lib/library-store.js";
import { canControl, usePlayer } from "../lib/player-store.js";

interface Props {
  onClose: () => void;
  onOpenCollection?: (kind: CollectionKind, id: string, title: string) => void;
  onOpenQueue: () => void;
}

/**
 * 全画面の再生画面。
 *
 * 下の細い帯を押すと開く。ジャケットを大きく置いて、
 * 歌詞に切り替えられるようにしてある。
 */
export function NowPlayingView({ onClose, onOpenCollection, onOpenQueue }: Props) {
  const player = usePlayer();
  const [showLyrics, setShowLyrics] = useState(false);
  const likes = useLibrary((s) => s.likes);
  const toggleLike = useLibrary((s) => s.toggleLike);
  const track = player.current();
  const liked = track ? likes.some((t) => t.id === track.id) : false;
  const duration = player.durationMs();
  const controllable = canControl(player);

  // 下へ払うと閉じる。指の動きにそのまま付いてくる。
  const dismiss = useSwipeToDismiss(onClose);

  if (!track) return null;

  return (
    <div
      ref={dismiss.ref}
      {...dismiss.bind}
      className="animate-cover-up sheet-drag fixed inset-0 z-40 flex flex-col"
      style={{
        // ジャケットの色を背景に溶かす。曲ごとに雰囲気が変わる。
        background: `linear-gradient(180deg, ${artworkGradient(track.id)
          .replace("linear-gradient(145deg, ", "")
          .split(",")[0]
          ?.trim()} -30%, var(--color-base) 55%)`,
      }}
    >
      {/* 下へ払えることを示す取っ手。触れる場所が見えると迷わない。 */}
      <div className="pad-top-safe flex justify-center pt-2 md:hidden">
        <span className="h-1 w-10 rounded-full bg-ink/25" />
      </div>

      <header className="flex items-center justify-between px-4 py-3 sm:px-6 md:pad-top-safe">
        <button
          type="button"
          onClick={onClose}
          className="grid size-10 place-items-center rounded-full text-ink transition hover:bg-white/10"
          aria-label="閉じる"
        >
          <ChevronDown className="size-6" />
        </button>
        <span className="truncate px-4 text-xs font-medium text-ink-muted">
          {track.album ?? "再生中"}
        </span>
        <button
          type="button"
          onClick={onOpenQueue}
          className="grid size-10 place-items-center rounded-full text-ink transition hover:bg-white/10"
          aria-label="再生キュー"
        >
          <ListMusic className="size-5" />
        </button>
      </header>

      <div className="flex min-h-0 flex-1 flex-col px-6 sm:px-10 lg:flex-row lg:items-center lg:gap-10">
        {/* ジャケット。歌詞に切り替えると脇に寄る。 */}
        <div
          className={`flex items-center justify-center transition-all ${
            showLyrics ? "hidden lg:flex lg:w-[38%]" : "min-h-0 flex-1"
          }`}
        >
          <Artwork
            seed={track.id}
            label={track.title}
            src={track.artworkUrl}
            className="aspect-square w-full max-w-[min(70vh,28rem)] text-8xl"
            rounded="rounded-lg"
          />
        </div>

        {showLyrics && (
          <div className="min-h-0 flex-1 lg:h-[60vh]">
            <LyricsPane track={track} />
          </div>
        )}

        <div className={showLyrics ? "lg:hidden" : "lg:w-[38%]"}>
          <div className="mt-6 flex items-start justify-between gap-4">
            <div className="min-w-0">
              <h1 className="truncate text-2xl font-bold sm:text-3xl">{track.title}</h1>
              {track.artistId && onOpenCollection ? (
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onOpenCollection("artist", track.artistId!, track.artist);
                  }}
                  className="mt-1 truncate text-base text-ink-muted transition hover:text-ink hover:underline"
                >
                  {track.artist}
                </button>
              ) : (
                <p className="mt-1 truncate text-base text-ink-muted">{track.artist}</p>
              )}
            </div>
            <button
              type="button"
              onClick={() => void toggleLike(track)}
              className={`press mt-1 shrink-0 transition ${
                liked ? "text-accent" : "text-ink-muted hover:text-ink"
              }`}
              aria-label={liked ? "お気に入りから外す" : "お気に入りに追加"}
              aria-pressed={liked}
            >
              <Heart className={`size-6 ${liked ? "fill-current" : ""}`} />
            </button>
          </div>

          <div className="mt-5">
            <ProgressBar
              value={player.positionMs}
              max={duration}
              onChange={player.seek}
              disabled={!controllable}
            />
            <div className="mt-1.5 flex justify-between text-[11px] tabular-nums text-ink-muted">
              <span>{formatDuration(player.positionMs)}</span>
              <span>{formatDuration(duration)}</span>
            </div>
          </div>

          <div className="mt-4 flex items-center justify-between">
            <button
              type="button"
              onClick={player.toggleShuffle}
              disabled={!controllable}
              className={`transition disabled:opacity-40 ${
                player.shuffle ? "text-accent" : "text-ink-muted hover:text-ink"
              }`}
              aria-label="シャッフル"
            >
              <Shuffle className="size-5" />
            </button>

            <div className="flex items-center gap-6">
              <button
                type="button"
                onClick={player.prev}
                disabled={!controllable}
                className="text-ink transition disabled:opacity-40"
                aria-label="前の曲"
              >
                <SkipBack className="size-8 fill-current" />
              </button>
              <button
                type="button"
                onClick={player.toggle}
                disabled={!controllable}
                className="grid size-16 place-items-center rounded-full bg-ink text-base transition hover:scale-105 disabled:opacity-40"
                aria-label={player.playing ? "一時停止" : "再生"}
              >
                {player.playing ? (
                  <Pause className="size-7 fill-current" />
                ) : (
                  <Play className="size-7 translate-x-0.5 fill-current" />
                )}
              </button>
              <button
                type="button"
                onClick={player.next}
                disabled={!controllable}
                className="text-ink transition disabled:opacity-40"
                aria-label="次の曲"
              >
                <SkipForward className="size-8 fill-current" />
              </button>
            </div>

            <button
              type="button"
              onClick={player.cycleRepeat}
              disabled={!controllable}
              className={`transition disabled:opacity-40 ${
                player.repeat !== "off" ? "text-accent" : "text-ink-muted hover:text-ink"
              }`}
              aria-label="リピート"
            >
              {player.repeat === "one" ? (
                <Repeat1 className="size-5" />
              ) : (
                <Repeat className="size-5" />
              )}
            </button>
          </div>
        </div>
      </div>

      <footer className="pad-bottom-safe flex justify-center px-6 pt-4">
        <button
          type="button"
          onClick={() => setShowLyrics((open) => !open)}
          className={`flex items-center gap-2 rounded-full px-4 py-2.5 text-sm font-medium transition ${
            showLyrics ? "bg-accent/15 text-accent" : "bg-white/10 text-ink-muted hover:text-ink"
          }`}
        >
          <Mic2 className="size-4" />
          歌詞
        </button>
      </footer>
    </div>
  );
}
