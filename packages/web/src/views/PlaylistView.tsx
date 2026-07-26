import { Download, Heart, MoreHorizontal, Play, Users } from "lucide-react";
import type { CacheState, Group, Playlist } from "@musicshare/shared";
import { Artwork } from "../components/Artwork.js";
import { TrackList } from "../components/TrackList.js";
import { artworkGradient } from "../lib/artwork.js";
import { formatTotalDuration } from "../lib/format.js";
import { tracksOf } from "../lib/mock.js";
import { usePlayer } from "../lib/player-store.js";

interface Props {
  playlist: Playlist;
  groups: Group[];
  cacheStates: Record<string, CacheState>;
}

export function PlaylistView({ playlist, groups, cacheStates }: Props) {
  const playQueue = usePlayer((s) => s.playQueue);
  const tracks = tracksOf(playlist);
  const group = groups.find((g) => g.id === playlist.groupId);

  return (
    <div>
      {/* ヘッダ。アートワークの色をそのまま背景に溶かす。 */}
      <div
        className="flex items-end gap-6 px-6 pt-24 pb-6"
        style={{
          background: `linear-gradient(180deg, ${artworkGradient(playlist.id)
            .replace("linear-gradient(145deg, ", "")
            .split(",")[0]
            ?.trim()} -60%, var(--color-surface) 100%)`,
        }}
      >
        <Artwork
          seed={playlist.id}
          label={playlist.name}
          className="size-[196px] text-6xl"
          rounded="rounded-md"
        />
        <div className="min-w-0 pb-2">
          <div className="text-xs font-medium">
            {group ? "共有プレイリスト" : "プレイリスト"}
          </div>
          <h1 className="mt-2 truncate text-6xl font-black tracking-tight">{playlist.name}</h1>
          {playlist.description && (
            <p className="mt-4 text-sm text-ink-muted">{playlist.description}</p>
          )}
          <div className="mt-3 flex items-center gap-1.5 text-sm text-ink-muted">
            {group && (
              <>
                <Users className="size-4" />
                <span className="font-medium text-ink">{group.name}</span>
                <span>·</span>
                <span>{group.memberIds.length} 人</span>
                <span>·</span>
              </>
            )}
            <span>{tracks.length} 曲</span>
            <span>·</span>
            <span>{formatTotalDuration(tracks.map((t) => t.durationMs))}</span>
          </div>
        </div>
      </div>

      {/* 操作列 */}
      <div className="flex items-center gap-6 px-6 py-6">
        <button
          type="button"
          onClick={() => playQueue(tracks, 0)}
          disabled={tracks.length === 0}
          className="grid size-14 place-items-center rounded-full bg-accent text-accent-ink shadow-xl shadow-black/30 transition hover:scale-105 disabled:opacity-40"
          aria-label="再生"
        >
          <Play className="size-6 translate-x-0.5 fill-current" />
        </button>
        <button
          type="button"
          className="text-ink-muted transition hover:text-ink"
          aria-label="ライブラリに追加"
        >
          <Heart className="size-7" />
        </button>
        <button
          type="button"
          className="text-ink-muted transition hover:text-ink"
          aria-label="すべてダウンロード"
          title="すべてダウンロード"
        >
          <Download className="size-6" />
        </button>
        <button
          type="button"
          className="text-ink-muted transition hover:text-ink"
          aria-label="その他"
        >
          <MoreHorizontal className="size-6" />
        </button>
      </div>

      <div className="px-2 pb-8">
        <TrackList
          tracks={tracks}
          cacheStates={cacheStates}
          onPlay={(index) => playQueue(tracks, index)}
        />
      </div>
    </div>
  );
}
