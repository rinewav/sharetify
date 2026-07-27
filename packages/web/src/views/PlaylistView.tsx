import { useState } from "react";
import { Download, MoreHorizontal, Play, Shuffle, Trash2, Users } from "lucide-react";
import type { CacheState, CollectionKind, Playlist } from "@musicshare/shared";
import { Artwork } from "../components/Artwork.js";
import { TrackList } from "../components/TrackList.js";
import { artworkGradient } from "../lib/artwork.js";
import { formatTotalDuration } from "../lib/format.js";
import { useLibrary } from "../lib/library-store.js";
import { nodeCache } from "../lib/node-client.js";
import { usePlayer } from "../lib/player-store.js";

interface Props {
  playlist: Playlist;
  cacheStates: Record<string, CacheState>;
  onOpenCollection: (kind: CollectionKind, id: string, title: string) => void;
  onLeave: () => void;
}

export function PlaylistView({ playlist, cacheStates, onOpenCollection, onLeave }: Props) {
  const playQueue = usePlayer((s) => s.playQueue);
  const { groupById, user, removeTrack, deletePlaylist } = useLibrary();
  const [menuOpen, setMenuOpen] = useState(false);

  const tracks = playlist.tracks;
  const group = playlist.groupId ? groupById(playlist.groupId) : undefined;
  const owned = playlist.ownerId === user?.id;

  return (
    <div>
      {/* ヘッダ。アートワークの色をそのまま背景に溶かす。 */}
      <div
        className="flex flex-col items-start gap-4 px-4 pt-24 pb-6 sm:flex-row sm:items-end sm:gap-6 sm:px-6"
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
          src={tracks[0]?.artworkUrl}
          className="size-[140px] text-5xl sm:size-[196px] sm:text-6xl"
          rounded="rounded-md"
        />
        <div className="min-w-0 pb-2">
          <div className="text-xs font-medium">
            {group ? "共有プレイリスト" : "プレイリスト"}
          </div>
          <h1 className="mt-2 text-3xl font-black tracking-tight sm:truncate sm:text-6xl">
            {playlist.name}
          </h1>
          {playlist.description && (
            <p className="mt-3 text-sm text-ink-muted sm:mt-4">{playlist.description}</p>
          )}
          <div className="mt-3 flex flex-wrap items-center gap-1.5 text-sm text-ink-muted">
            {group && (
              <>
                <Users className="size-4" />
                <span className="font-medium text-ink">{group.name}</span>
                <span>·</span>
                <span>{group.members.length} 人</span>
                <span>·</span>
              </>
            )}
            <span>{tracks.length} 曲</span>
            {tracks.length > 0 && (
              <>
                <span>·</span>
                <span>{formatTotalDuration(tracks.map((t) => t.durationMs))}</span>
              </>
            )}
          </div>
        </div>
      </div>

      {/* 操作列 */}
      <div className="relative flex items-center gap-5 px-4 py-5 sm:gap-6 sm:px-6 sm:py-6">
        <button
          type="button"
          onClick={() => playQueue(tracks, 0)}
          disabled={tracks.length === 0}
          className="press grid size-14 place-items-center rounded-full bg-accent text-accent-ink shadow-xl shadow-black/30 transition hover:scale-105 disabled:opacity-40"
          aria-label="再生"
        >
          <Play className="size-6 translate-x-0.5 fill-current" />
        </button>
        <button
          type="button"
          onClick={() => playQueue(shuffled(tracks), 0)}
          disabled={tracks.length === 0}
          className="text-ink-muted transition hover:text-ink disabled:opacity-40"
          aria-label="シャッフル再生"
        >
          <Shuffle className="size-6" />
        </button>
        <button
          type="button"
          onClick={() => void nodeCache(tracks.map((t) => t.id))}
          disabled={tracks.length === 0}
          className="text-ink-muted transition hover:text-ink disabled:opacity-40"
          aria-label="すべてダウンロード"
          title="すべてダウンロード"
        >
          <Download className="size-6" />
        </button>
        <button
          type="button"
          onClick={() => setMenuOpen((open) => !open)}
          className="text-ink-muted transition hover:text-ink"
          aria-label="その他"
        >
          <MoreHorizontal className="size-6" />
        </button>

        {menuOpen && owned && (
          <div className="absolute top-full left-4 z-10 w-56 rounded-md border border-line bg-surface-2 p-1 shadow-xl sm:left-6">
            <button
              type="button"
              onClick={() => {
                setMenuOpen(false);
                void deletePlaylist(playlist.id).then(onLeave);
              }}
              className="flex w-full items-center gap-2 rounded px-3 py-2 text-left text-sm text-red-300 transition hover:bg-surface-3"
            >
              <Trash2 className="size-4" />
              このプレイリストを削除
            </button>
          </div>
        )}
      </div>

      {tracks.length === 0 ? (
        <div className="px-4 pb-8 text-sm text-ink-faint sm:px-6">
          まだ空です。検索した曲の行から追加できます。
        </div>
      ) : (
        <div className="px-2 pb-8">
          <TrackList
            tracks={tracks}
            cacheStates={cacheStates}
            onPlay={(index) => playQueue(tracks, index)}
            onOpenCollection={onOpenCollection}
            onRemove={(trackId) => void removeTrack(playlist.id, trackId)}
          />
        </div>
      )}
    </div>
  );
}

/** 並べ替えた写しを返す。元の配列には触らない。 */
function shuffled<T>(items: T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j]!, copy[i]!];
  }
  return copy;
}
