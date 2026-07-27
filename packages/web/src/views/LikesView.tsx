import { Download, Heart, Play, Shuffle } from "lucide-react";
import type { CacheState, CollectionKind } from "@musicshare/shared";
import { TrackList } from "../components/TrackList.js";
import { formatTotalDuration } from "../lib/format.js";
import { useLibrary } from "../lib/library-store.js";
import { nodeCache } from "../lib/node-client.js";
import { usePlayer } from "../lib/player-store.js";

interface Props {
  cacheStates: Record<string, CacheState>;
  onOpenCollection: (kind: CollectionKind, id: string, title: string) => void;
}

/**
 * 気に入った曲。
 *
 * どこで出会っても同じ印を付けられるので、集めた結果はここに溜まる。
 * 並びとしても扱えるよう、まとめて流せるようにしてある。
 */
export function LikesView({ cacheStates, onOpenCollection }: Props) {
  const likes = useLibrary((s) => s.likes);
  const unlike = useLibrary((s) => s.unlike);
  const playQueue = usePlayer((s) => s.playQueue);

  return (
    <div>
      <div className="flex flex-col items-start gap-4 px-4 pt-24 pb-6 sm:flex-row sm:items-end sm:gap-6 sm:px-6">
        {/* ジャケットの代わりに、印そのものを大きく置く。 */}
        <div className="grid size-[140px] shrink-0 place-items-center rounded-md bg-gradient-to-br from-accent to-accent-strong text-accent-ink shadow-xl sm:size-[196px]">
          <Heart className="size-16 fill-current sm:size-24" />
        </div>
        <div className="min-w-0 pb-2">
          <div className="text-xs font-medium">コレクション</div>
          <h1 className="mt-2 text-3xl font-black tracking-tight sm:text-6xl">お気に入りの曲</h1>
          <div className="mt-3 flex flex-wrap items-center gap-1.5 text-sm text-ink-muted">
            <span>{likes.length} 曲</span>
            {likes.length > 0 && (
              <>
                <span>·</span>
                <span>{formatTotalDuration(likes.map((t) => t.durationMs))}</span>
              </>
            )}
          </div>
        </div>
      </div>

      <div className="flex items-center gap-5 px-4 py-5 sm:gap-6 sm:px-6 sm:py-6">
        <button
          type="button"
          onClick={() => playQueue(likes, 0)}
          disabled={likes.length === 0}
          className="press grid size-14 place-items-center rounded-full bg-accent text-accent-ink shadow-xl shadow-black/30 transition hover:scale-105 disabled:opacity-40"
          aria-label="再生"
        >
          <Play className="size-6 translate-x-0.5 fill-current" />
        </button>
        <button
          type="button"
          onClick={() => playQueue(shuffled(likes), 0)}
          disabled={likes.length === 0}
          className="text-ink-muted transition hover:text-ink disabled:opacity-40"
          aria-label="シャッフル再生"
        >
          <Shuffle className="size-6" />
        </button>
        <button
          type="button"
          onClick={() => void nodeCache(likes.map((t) => t.id))}
          disabled={likes.length === 0}
          className="text-ink-muted transition hover:text-ink disabled:opacity-40"
          aria-label="すべてダウンロード"
          title="すべてダウンロード"
        >
          <Download className="size-6" />
        </button>
      </div>

      {likes.length === 0 ? (
        <div className="px-4 pb-8 text-sm text-ink-faint sm:px-6">
          まだありません。曲のハートを押すと、ここに溜まっていきます。
        </div>
      ) : (
        <div className="px-2 pb-8">
          <TrackList
            tracks={likes}
            cacheStates={cacheStates}
            onPlay={(index) => playQueue(likes, index)}
            onOpenCollection={onOpenCollection}
            onRemove={(trackId) => void unlike(trackId)}
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
