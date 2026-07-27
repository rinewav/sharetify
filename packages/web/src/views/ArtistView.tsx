import { useEffect, useState } from "react";
import { Check, ChevronDown, Loader2, Play, Plus, Shuffle } from "lucide-react";
import type { CacheState, CollectionKind, CollectionResponse, Track } from "@musicshare/shared";
import { Artwork } from "../components/Artwork.js";
import type { MenuItem } from "../components/ContextMenu.js";
import { ResultCard } from "../components/ResultCard.js";
import { TrackList } from "../components/TrackList.js";
import { formatCount } from "../lib/format.js";
import { useLibrary } from "../lib/library-store.js";
import { nodeCollection } from "../lib/node-client.js";
import { usePlayer } from "../lib/player-store.js";
import { useCollectionMenuItems, useContextMenu } from "../lib/track-menu.js";

interface Props {
  id: string;
  fallbackTitle?: string;
  cacheStates: Record<string, CacheState>;
  onOpenCollection: (kind: CollectionKind, id: string, title: string) => void;
  onAddTo: (track: Track) => void;
}

/** 最初に見せる曲数。全部並べると下のまとまりまで届かない。 */
const TOP_TRACKS = 5;

/**
 * アーティストのページ。
 *
 * 曲だけを縦に並べても、その人の全体像は掴めない。
 * 代表曲・アルバム・シングル・近いアーティストを分けて置き、
 * どこからでも辿れるようにする。
 */
export function ArtistView({ id, fallbackTitle, cacheStates, onOpenCollection, onAddTo }: Props) {
  const [data, setData] = useState<CollectionResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const playQueue = usePlayer((s) => s.playQueue);
  const { isFollowing, follow, unfollow } = useLibrary();

  // 札の右クリック。曲の一覧は TrackList が自前で持っている。
  const menu = useContextMenu();
  const collectionItems = useCollectionMenuItems();

  /** まとまりを開かずにその場で流す。中身は必要になってから取りにいく。 */
  const playCollection = async (kind: CollectionKind, collectionId: string) => {
    try {
      const collection = await nodeCollection(kind, collectionId);
      if (collection.tracks.length > 0) playQueue(collection.tracks, 0);
    } catch {
      // 開いて確かめてもらえばよいので、ここでは黙って諦める。
    }
  };

  const cardMenu =
    (kind: CollectionKind, target: { id: string; title: string; artworkUrl?: string }) => () =>
      collectionItems({
        kind,
        id: target.id,
        title: target.title,
        ...(target.artworkUrl ? { artworkUrl: target.artworkUrl } : {}),
        onOpen: () => onOpenCollection(kind, target.id, target.title),
        onPlay: () => void playCollection(kind, target.id),
      });

  useEffect(() => {
    const controller = new AbortController();
    setData(null);
    setError(null);
    setExpanded(false);

    nodeCollection("artist", id, controller.signal)
      .then((result) => {
        if (!controller.signal.aborted) setData(result);
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return;
        setError(cause instanceof Error ? cause.message : "取得できませんでした。");
      });

    return () => controller.abort();
  }, [id]);

  const tracks = data?.tracks ?? [];
  const shown = expanded ? tracks : tracks.slice(0, TOP_TRACKS);
  const title = data?.title || fallbackTitle || "読み込み中";
  const following = isFollowing(id);

  const listeners = formatCount(data?.monthlyListeners);
  const subscribers = formatCount(data?.subscriberCount);

  return (
    <div>
      {/* 上部。人物が主役なので画像を大きく出す。 */}
      <div className="flex flex-col items-start gap-4 px-4 pt-24 pb-6 sm:flex-row sm:items-end sm:gap-6 sm:px-6">
        <Artwork
          seed={id}
          label={title}
          src={data?.artworkUrl}
          className="size-[140px] text-5xl sm:size-[196px] sm:text-6xl"
          rounded="rounded-full"
        />
        <div className="min-w-0 pb-2">
          <div className="text-xs font-medium">アーティスト</div>
          <h1 className="mt-2 text-3xl font-black tracking-tight sm:truncate sm:text-6xl">
            {title}
          </h1>
          <div className="mt-3 flex flex-wrap items-center gap-1.5 text-sm text-ink-muted">
            {listeners && <span>月間リスナー {listeners} 人</span>}
            {listeners && subscribers && <span>·</span>}
            {subscribers && <span>登録者 {subscribers} 人</span>}
          </div>
        </div>
      </div>

      {/* 操作列 */}
      <div className="flex items-center gap-4 px-4 py-5 sm:gap-6 sm:px-6 sm:py-6">
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
        {/* 気に入ったら控えておく。左の一覧に出て、次に開きやすくなる。 */}
        <button
          type="button"
          onClick={() =>
            following
              ? void unfollow(id)
              : void follow({ id, name: title, artworkUrl: data?.artworkUrl })
          }
          className={`flex items-center gap-1.5 rounded-full border px-4 py-2 text-sm font-medium transition ${
            following
              ? "border-accent text-accent"
              : "border-line text-ink-muted hover:border-ink-muted hover:text-ink"
          }`}
        >
          {following ? <Check className="size-4" /> : <Plus className="size-4" />}
          {following ? "フォロー中" : "フォロー"}
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
        <section className="px-2 pb-2">
          <h2 className="px-2 pb-3 text-xl font-bold tracking-tight sm:px-4 sm:text-2xl">
            人気の曲
          </h2>
          <TrackList
            tracks={shown}
            cacheStates={cacheStates}
            onPlay={(index) => playQueue(tracks, index)}
            onOpenCollection={onOpenCollection}
            onAddTo={onAddTo}
          />
          {tracks.length > TOP_TRACKS && (
            <button
              type="button"
              onClick={() => setExpanded((open) => !open)}
              className="mt-2 flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-ink-muted transition hover:text-ink"
            >
              <ChevronDown
                className={`size-4 transition-transform ${expanded ? "rotate-180" : ""}`}
              />
              {expanded ? "たたむ" : `すべて表示 (${tracks.length} 曲)`}
            </button>
          )}
        </section>
      )}

      <Releases
        title="アルバム"
        items={data?.albums ?? []}
        onOpen={(release) => onOpenCollection("album", release.id, release.title)}
        onMenu={(release) => cardMenu("album", release)}
        onOpenMenu={menu.openAt}
      />
      <Releases
        title="シングル・EP"
        items={data?.singles ?? []}
        onOpen={(release) => onOpenCollection("album", release.id, release.title)}
        onMenu={(release) => cardMenu("album", release)}
        onOpenMenu={menu.openAt}
      />

      {(data?.related?.length ?? 0) > 0 && (
        <Section title="似ているアーティスト">
          {data!.related!.map((artist) => (
            <ResultCard
              key={artist.id}
              seed={artist.id}
              title={artist.name}
              subtitle={
                formatCount(artist.subscriberCount)
                  ? `登録者 ${formatCount(artist.subscriberCount)} 人`
                  : "アーティスト"
              }
              artworkUrl={artist.artworkUrl}
              round
              onOpen={() => onOpenCollection("artist", artist.id, artist.name)}
              menuItems={cardMenu("artist", {
                id: artist.id,
                title: artist.name,
                ...(artist.artworkUrl ? { artworkUrl: artist.artworkUrl } : {}),
              })}
              onOpenMenu={menu.openAt}
            />
          ))}
        </Section>
      )}

      {data?.description && (
        <section className="px-4 pt-8 pb-10 sm:px-6">
          <h2 className="mb-3 text-xl font-bold tracking-tight sm:text-2xl">紹介</h2>
          <p className="max-w-3xl text-sm leading-relaxed whitespace-pre-line text-ink-muted">
            {data.description}
          </p>
        </section>
      )}

      {menu.node}
    </div>
  );
}

interface Release {
  id: string;
  title: string;
  year?: string;
  kind?: string;
  artworkUrl?: string;
}

function Releases({
  title,
  items,
  onOpen,
  onMenu,
  onOpenMenu,
}: {
  title: string;
  items: Release[];
  onOpen: (item: Release) => void;
  onMenu: (item: Release) => () => MenuItem[];
  onOpenMenu: (x: number, y: number, items: MenuItem[]) => void;
}) {
  if (items.length === 0) return null;
  return (
    <Section title={title}>
      {items.map((item) => (
        <ResultCard
          key={item.id}
          seed={item.id}
          title={item.title}
          subtitle={[item.kind, item.year].filter(Boolean).join(" · ") || "リリース"}
          artworkUrl={item.artworkUrl}
          onOpen={() => onOpen(item)}
          menuItems={onMenu(item)}
          onOpenMenu={onOpenMenu}
        />
      ))}
    </Section>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="px-4 pt-8 sm:px-6">
      <h2 className="mb-4 text-xl font-bold tracking-tight sm:text-2xl">{title}</h2>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-5 xl:grid-cols-6">
        {children}
      </div>
    </section>
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
