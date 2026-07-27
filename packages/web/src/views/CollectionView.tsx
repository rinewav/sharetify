import { useEffect, useState } from "react";
import { Download, Loader2, Play, Shuffle } from "lucide-react";
import type { CacheState, CollectionKind, CollectionResponse } from "@musicshare/shared";
import { Artwork } from "../components/Artwork.js";
import { TrackList } from "../components/TrackList.js";
import { formatTotalDuration } from "../lib/format.js";
import { nodeCache, nodeCollection } from "../lib/node-client.js";
import { usePlayer } from "../lib/player-store.js";

interface Props {
  kind: CollectionKind;
  id: string;
  /** 開く前に分かっている名前。取得を待つ間の見出しに使う。 */
  fallbackTitle?: string;
  cacheStates: Record<string, CacheState>;
}

/** 検索から開いたアルバム・プレイリスト・アーティストの中身。 */
export function CollectionView({ kind, id, fallbackTitle, cacheStates }: Props) {
  const [data, setData] = useState<CollectionResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const playQueue = usePlayer((s) => s.playQueue);

  useEffect(() => {
    const controller = new AbortController();
    setData(null);
    setError(null);

    nodeCollection(kind, id, controller.signal)
      .then((result) => {
        if (!controller.signal.aborted) setData(result);
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return;
        setError(cause instanceof Error ? cause.message : "中身を取得できませんでした。");
      });

    return () => controller.abort();
  }, [kind, id]);

  const tracks = data?.tracks ?? [];
  const title = data?.title || fallbackTitle || "読み込み中";

  return (
    <div>
      <div className="flex flex-col items-start gap-4 px-4 pt-24 pb-6 sm:flex-row sm:items-end sm:gap-6 sm:px-6">
        <Artwork
          seed={id}
          label={title}
          src={data?.artworkUrl}
          className="size-[140px] text-5xl sm:size-[196px] sm:text-6xl"
          rounded={kind === "artist" ? "rounded-full" : "rounded-md"}
        />
        <div className="min-w-0 pb-2">
          <div className="text-xs font-medium">{labelFor(kind)}</div>
          <h1 className="mt-2 text-3xl font-black tracking-tight sm:truncate sm:text-6xl">
            {title}
          </h1>
          {data?.subtitle && <p className="mt-3 text-sm text-ink-muted">{data.subtitle}</p>}
          {tracks.length > 0 && (
            <div className="mt-3 flex flex-wrap items-center gap-1.5 text-sm text-ink-muted">
              <span>{tracks.length} 曲</span>
              <span>·</span>
              <span>{formatTotalDuration(tracks.map((t) => t.durationMs))}</span>
            </div>
          )}
        </div>
      </div>

      <div className="flex items-center gap-5 px-4 py-5 sm:gap-6 sm:px-6 sm:py-6">
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
      </div>

      {error && (
        <div className="mx-4 rounded-md border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200 sm:mx-6">
          {error}
        </div>
      )}

      {!data && !error && (
        <div className="flex items-center gap-2 px-4 py-10 text-sm text-ink-faint sm:px-6">
          <Loader2 className="size-4 animate-spin" />
          読み込んでいます…
        </div>
      )}

      {tracks.length > 0 && (
        <div className="px-2 pb-8">
          <TrackList
            tracks={tracks}
            cacheStates={cacheStates}
            onPlay={(index) => playQueue(tracks, index)}
            showAlbum={kind !== "album"}
          />
        </div>
      )}
    </div>
  );
}

function labelFor(kind: CollectionKind): string {
  if (kind === "album") return "アルバム";
  if (kind === "artist") return "アーティスト";
  return "プレイリスト";
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
