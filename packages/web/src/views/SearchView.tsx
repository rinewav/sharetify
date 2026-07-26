import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import type { CacheState } from "@musicshare/shared";
import { TrackList } from "../components/TrackList.js";
import { mockTracks } from "../lib/mock.js";
import { usePlayer } from "../lib/player-store.js";

interface Props {
  cacheStates: Record<string, CacheState>;
  /** node に問い合わせられる状態か。落ちていると検索できないことを伝える。 */
  nodeOnline: boolean;
}

export function SearchView({ cacheStates, nodeOnline }: Props) {
  const [query, setQuery] = useState("");
  const playQueue = usePlayer((s) => s.playQueue);

  // 仮組みなのでローカルの絞り込み。実装が進んだら node の検索 API に置き換える。
  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return mockTracks.filter(
      (track) =>
        track.title.toLowerCase().includes(q) ||
        track.artist.toLowerCase().includes(q) ||
        (track.album?.toLowerCase().includes(q) ?? false),
    );
  }, [query]);

  return (
    <div className="px-6 pt-20 pb-8">
      <div className="relative max-w-md">
        <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-faint" />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="曲、アーティスト、アルバム"
          className="w-full rounded-full bg-surface-3 py-3 pr-4 pl-10 text-sm outline-none placeholder:text-ink-faint focus:ring-2 focus:ring-ink/20"
        />
      </div>

      {!nodeOnline && (
        <div className="mt-4 rounded-md border border-line bg-surface px-4 py-3 text-sm text-ink-muted">
          自分の PC に接続できていません。ダウンロード済みの曲だけ再生できます。
        </div>
      )}

      {query.trim() === "" ? (
        <div className="mt-10 text-sm text-ink-faint">
          聴きたいものを入力してください。
        </div>
      ) : results.length === 0 ? (
        <div className="mt-10 text-sm text-ink-faint">
          「{query}」に一致するものは見つかりませんでした。
        </div>
      ) : (
        <div className="mt-8">
          <h2 className="mb-4 text-xl font-bold tracking-tight">曲</h2>
          <TrackList
            tracks={results}
            cacheStates={cacheStates}
            onPlay={(index) => playQueue(results, index)}
          />
        </div>
      )}
    </div>
  );
}
