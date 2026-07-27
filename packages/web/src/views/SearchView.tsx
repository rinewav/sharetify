import { useEffect, useState } from "react";
import { Download, Loader2, Search } from "lucide-react";
import type { CacheState, NodeHealth, Track } from "@musicshare/shared";
import { TrackList } from "../components/TrackList.js";
import { nodeCache, nodeSearch } from "../lib/node-client.js";
import { usePlayer } from "../lib/player-store.js";

interface Props {
  cacheStates: Record<string, CacheState>;
  health: NodeHealth | null;
}

export function SearchView({ cacheStates, health }: Props) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Track[]>([]);
  const [error, setError] = useState<string | null>(null);
  /**
   * 「入力済みだが、まだ答えが返っていない」状態を 1 つの値で持つ。
   * 待ち時間と通信中を別々の真偽値にすると、その隙間で
   * 一瞬だけ「見つかりません」が出てしまう。
   */
  const [phase, setPhase] = useState<"idle" | "pending" | "done">("idle");
  const playQueue = usePlayer((s) => s.playQueue);

  const online = health?.ok === true;

  // 打つたびに問い合わせると自分の PC に無駄な負荷がかかるので、少し待ってから投げる。
  useEffect(() => {
    const term = query.trim();
    if (!term) {
      setResults([]);
      setError(null);
      setPhase("idle");
      return;
    }
    if (!online) return;

    // 入力された時点で待ちに入る。ここから結果が確定するまで空表示は出さない。
    setPhase("pending");
    setError(null);

    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const { tracks } = await nodeSearch(term, 20, controller.signal);
        if (controller.signal.aborted) return;
        setResults(tracks);
        setPhase("done");
      } catch (cause) {
        if (controller.signal.aborted) return;
        setError(cause instanceof Error ? cause.message : "検索に失敗しました。");
        setResults([]);
        setPhase("done");
      }
    }, 450);

    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [query, online]);

  const loading = phase === "pending";

  return (
    <div className="px-4 pt-20 pb-8 sm:px-6">
      <div className="relative max-w-md">
        <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-faint" />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="曲、アーティスト、アルバム"
          autoCapitalize="off"
          autoCorrect="off"
          className="w-full rounded-full bg-surface-3 py-3 pr-10 pl-10 text-base outline-none placeholder:text-ink-faint focus:ring-2 focus:ring-ink/20 sm:text-sm"
        />
        {loading && (
          <Loader2 className="absolute top-1/2 right-3 size-4 -translate-y-1/2 animate-spin text-ink-faint" />
        )}
      </div>

      {!online && (
        <div className="mt-4 rounded-md border border-line bg-surface-2 px-4 py-3 text-sm text-ink-muted">
          自分の PC に接続できていません。ダウンロード済みの曲だけ再生できます。
        </div>
      )}

      {error && (
        <div className="mt-4 rounded-md border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
          {error}
        </div>
      )}

      {phase === "idle" ? (
        <div className="mt-10 text-sm text-ink-faint">聴きたいものを入力してください。</div>
      ) : phase === "done" && results.length === 0 && !error ? (
        <div className="mt-10 text-sm text-ink-faint">
          「{query}」に一致するものは見つかりませんでした。
        </div>
      ) : results.length > 0 ? (
        <div className="mt-8">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-xl font-bold tracking-tight">曲</h2>
            <button
              type="button"
              onClick={() => void nodeCache(results.slice(0, 10).map((t) => t.id))}
              className="flex items-center gap-1.5 rounded-full bg-surface-3 px-3 py-1.5 text-xs text-ink-muted transition hover:text-ink"
              title="上位10件をオフライン用に保存"
            >
              <Download className="size-3.5" />
              まとめて保存
            </button>
          </div>
          <TrackList
            tracks={results}
            cacheStates={cacheStates}
            onPlay={(index) => playQueue(results, index)}
            showAlbum={false}
          />
        </div>
      ) : null}
    </div>
  );
}
