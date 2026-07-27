import { useEffect, useState } from "react";
import { Download, Loader2, Search } from "lucide-react";
import type { CacheState, CollectionKind, NodeHealth, SearchResponse } from "@musicshare/shared";
import { ResultCard } from "../components/ResultCard.js";
import { TrackList } from "../components/TrackList.js";
import { nodeCache, nodeCollection, nodeSearch } from "../lib/node-client.js";
import { usePlayer } from "../lib/player-store.js";
import type { Route } from "../lib/routes.js";

interface Props {
  cacheStates: Record<string, CacheState>;
  health: NodeHealth | null;
  onNavigate: (route: Route) => void;
}

const EMPTY: SearchResponse = { tracks: [], albums: [], artists: [], playlists: [] };

/** 曲だけでなく、アーティスト・アルバム・プレイリストも並べる。 */
export function SearchView({ cacheStates, health, onNavigate }: Props) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResponse>(EMPTY);
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
      setResults(EMPTY);
      setError(null);
      setPhase("idle");
      return;
    }
    if (!online) return;

    setPhase("pending");
    setError(null);

    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const found = await nodeSearch(term, 20, controller.signal);
        if (controller.signal.aborted) return;
        setResults({ ...EMPTY, ...found });
        setPhase("done");
      } catch (cause) {
        if (controller.signal.aborted) return;
        setError(cause instanceof Error ? cause.message : "検索に失敗しました。");
        setResults(EMPTY);
        setPhase("done");
      }
    }, 450);

    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [query, online]);

  const open = (kind: CollectionKind, id: string, title: string) =>
    onNavigate({ name: "collection", kind, id, title });

  /** 札の再生ボタン。開かずにその場でキューへ入れる。 */
  const playCollection = async (kind: CollectionKind, id: string) => {
    try {
      const collection = await nodeCollection(kind, id);
      if (collection.tracks.length > 0) playQueue(collection.tracks, 0);
    } catch {
      // 開いて確かめてもらえばよいので、ここでは黙って諦める。
    }
  };

  const { tracks, albums, artists, playlists } = results;
  const nothingFound =
    phase === "done" &&
    !error &&
    tracks.length === 0 &&
    albums.length === 0 &&
    artists.length === 0 &&
    playlists.length === 0;

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
        {phase === "pending" && (
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

      {phase === "idle" && (
        <div className="mt-10 text-sm text-ink-faint">聴きたいものを入力してください。</div>
      )}

      {nothingFound && (
        <div className="mt-10 text-sm text-ink-faint">
          「{query}」に一致するものは見つかりませんでした。
        </div>
      )}

      {artists.length > 0 && (
        <Section title="アーティスト">
          {artists.map((artist) => (
            <ResultCard
              key={artist.id}
              seed={artist.id}
              title={artist.name}
              subtitle={artist.subscribers ? `登録者 ${artist.subscribers}` : "アーティスト"}
              artworkUrl={artist.artworkUrl}
              round
              onOpen={() => open("artist", artist.id, artist.name)}
              onPlay={() => void playCollection("artist", artist.id)}
            />
          ))}
        </Section>
      )}

      {tracks.length > 0 && (
        <section className="mt-8">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-xl font-bold tracking-tight sm:text-2xl">曲</h2>
            <button
              type="button"
              onClick={() => void nodeCache(tracks.slice(0, 10).map((t) => t.id))}
              className="flex items-center gap-1.5 rounded-full bg-surface-3 px-3 py-1.5 text-xs text-ink-muted transition hover:text-ink"
              title="上位10件をオフライン用に保存"
            >
              <Download className="size-3.5" />
              まとめて保存
            </button>
          </div>
          <TrackList
            tracks={tracks}
            cacheStates={cacheStates}
            onPlay={(index) => playQueue(tracks, index)}
            showAlbum={false}
          />
        </section>
      )}

      {albums.length > 0 && (
        <Section title="アルバム・シングル">
          {albums.map((album) => (
            <ResultCard
              key={album.id}
              seed={album.id}
              title={album.title}
              subtitle={[album.kind, album.year, album.artist].filter(Boolean).join(" · ")}
              artworkUrl={album.artworkUrl}
              onOpen={() => open("album", album.id, album.title)}
              onPlay={() => void playCollection("album", album.id)}
            />
          ))}
        </Section>
      )}

      {playlists.length > 0 && (
        <Section title="プレイリスト">
          {playlists.map((playlist) => (
            <ResultCard
              key={playlist.id}
              seed={playlist.id}
              title={playlist.title}
              subtitle={
                [playlist.author, playlist.itemCount ? `${playlist.itemCount} 曲` : null]
                  .filter(Boolean)
                  .join(" · ") || "プレイリスト"
              }
              artworkUrl={playlist.artworkUrl}
              onOpen={() => open("playlist", playlist.id, playlist.title)}
              onPlay={() => void playCollection("playlist", playlist.id)}
            />
          ))}
        </Section>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-8">
      <h2 className="mb-4 text-xl font-bold tracking-tight sm:text-2xl">{title}</h2>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-5 xl:grid-cols-6">
        {children}
      </div>
    </section>
  );
}
