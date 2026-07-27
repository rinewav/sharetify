import { useEffect, useMemo, useState } from "react";
import { ListMusic, Play, Search, Sparkles } from "lucide-react";
import type { CollectionKind, DiscoverSection, Track } from "@sharetify/shared";
import { Artwork } from "../components/Artwork.js";
import type { MenuItem } from "../components/ContextMenu.js";
import { LinkedName } from "../components/LinkedName.js";
import { PressableCard } from "../components/PressableCard.js";
import { formatCount } from "../lib/format.js";
import { useLibrary } from "../lib/library-store.js";
import { nodeCollection, nodeDiscover, nodeRadio } from "../lib/node-client.js";
import { openByName } from "../lib/open-by-name.js";
import {
  formatListeningTime,
  forgottenFavorites,
  longListens,
  monthlyRecap,
  onHistoryChange,
  pickSeeds,
  recentTracks,
  topArtists,
  type Recap,
} from "../lib/play-history.js";
import { usePlayer } from "../lib/player-store.js";
import type { Route } from "../lib/routes.js";
import {
  trackMenuItems,
  useCollectionMenuItems,
  useContextMenu,
  type CollectionMenuTarget,
} from "../lib/track-menu.js";

interface Props {
  onNavigate: (route: Route) => void;
  nodeOnline: boolean;
  /** 曲をプレイリストへ入れる入口。右クリックの品書きから使う。 */
  onAddTo: (track: Track) => void;
}

/**
 * ホーム。
 *
 * 上に行くほど自分の跡が濃く、下に行くほど広い世界になるよう並べる。
 * 何を勧めるかは自前で考えず、聴いた跡から「種」を選んで供給元に委ねる。
 * 跡が無いうちは押しつけず、探す入口だけ出す。
 */
export function HomeView({ onNavigate, nodeOnline, onAddTo }: Props) {
  const { playlists, groups, follows, user } = useLibrary();
  const playQueue = usePlayer((s) => s.playQueue);

  // 右クリックの品書き。札で並ぶ画面でも一覧と同じ操作が出るようにする。
  const menu = useContextMenu();
  const collectionItems = useCollectionMenuItems();

  /*
   * 跡が変わったら組み立て直す。
   * 開いた時点のまま出していると、消したはずのものが並び続ける。
   */
  const [historyAt, setHistoryAt] = useState(0);
  useEffect(() => onHistoryChange(() => setHistoryAt((n) => n + 1)), []);

  const recent = useMemo(() => recentTracks(12), [historyAt]);
  const forgotten = useMemo(() => forgottenFavorites(12), [historyAt]);
  const longOnes = useMemo(() => longListens(12), [historyAt]);
  const recap = useMemo(() => monthlyRecap(), [historyAt]);
  const seeds = useMemo(() => pickSeeds(2), [historyAt]);

  const mixes = useMixes(seeds, nodeOnline);
  const discover = useDiscover(nodeOnline);

  const recentPlaylists = [...playlists].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const hasHistory = recent.length > 0;

  const openArtist = (id: string, name: string) =>
    onNavigate({ name: "collection", kind: "artist", id, title: name });

  const openCollection = (kind: CollectionKind, id: string, title: string) =>
    onNavigate({ name: "collection", kind, id, title });

  /** 曲の札に品書きを付ける。押した場から鳴らせるよう、再生の仕方も受け取る。 */
  const trackMenu = (track: Track, onPlay: () => void) => () =>
    trackMenuItems(track, { onPlay, onAddTo, onOpenCollection: openCollection });

  /** まとまりを開かずにその場で流す。中身は必要になってから取りにいく。 */
  const playCollection = async (kind: CollectionKind, id: string) => {
    try {
      const collection = await nodeCollection(kind, id);
      if (collection.tracks.length > 0) playQueue(collection.tracks, 0);
    } catch {
      // 開いて確かめてもらえばよいので、ここでは黙って諦める。
    }
  };

  const collectionMenu = (target: CollectionMenuTarget) => () =>
    collectionItems({ onPlay: () => void playCollection(target.kind, target.id), ...target });

  return (
    <div className="px-4 pt-20 pb-8 sm:px-6">
      <h1 className="animate-rise text-2xl font-bold tracking-tight sm:text-3xl">
        {greetingForNow()}
        {user ? `、${user.displayName}` : ""}
      </h1>

      {!hasHistory && playlists.length === 0 && (
        <div className="animate-rise mt-8 rounded-lg bg-surface p-6">
          <h2 className="text-lg font-semibold">まずは一曲さがす</h2>
          <p className="mt-2 text-sm text-ink-muted">
            聴いた曲をもとに、次に流すものを組み立てます。
            検索して曲の行の ＋ を押すと、プレイリストにも入れられます。
          </p>
          <button
            type="button"
            onClick={() => onNavigate({ name: "search" })}
            className="press mt-5 flex items-center gap-2 rounded-full bg-accent px-5 py-2.5 text-sm font-semibold text-accent-ink transition hover:brightness-110"
          >
            <Search className="size-4" />
            検索へ
          </button>
        </div>
      )}

      {/* 自分の書棚への近道。いちばん手が伸びる場所に置く。 */}
      {recentPlaylists.length > 0 && (
        <div className="animate-rise mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {recentPlaylists.slice(0, 6).map((playlist) => (
            <PressableCard
              key={playlist.id}
              onClick={() => onNavigate({ name: "playlist", playlistId: playlist.id })}
              menuItems={() => [
                ...(playlist.tracks.length > 0
                  ? [
                      {
                        label: "再生",
                        icon: <Play className="size-4" />,
                        onSelect: () => playQueue(playlist.tracks, 0),
                      },
                    ]
                  : []),
                {
                  label: "プレイリストを開く",
                  icon: <ListMusic className="size-4" />,
                  onSelect: () => onNavigate({ name: "playlist", playlistId: playlist.id }),
                  separated: playlist.tracks.length > 0,
                },
              ]}
              onOpenMenu={menu.openAt}
              className="press group flex w-full items-center gap-3 overflow-hidden rounded-md bg-surface-2 pr-3 text-left transition hover:bg-surface-3"
            >
              <Artwork
                seed={playlist.id}
                label={playlist.name}
                src={playlist.tracks[0]?.artworkUrl}
                className="size-16 text-2xl"
                rounded="rounded-none"
              />
              <span className="min-w-0 flex-1 truncate text-sm font-semibold">
                {playlist.name}
              </span>
              {playlist.tracks.length > 0 && (
                <span
                  onClick={(event) => {
                    event.stopPropagation();
                    playQueue(playlist.tracks, 0);
                  }}
                  className="grid size-10 shrink-0 translate-y-1 place-items-center rounded-full bg-accent text-accent-ink opacity-0 shadow-lg transition group-hover:translate-y-0 group-hover:opacity-100"
                >
                  <Play className="size-4 translate-x-px fill-current" />
                </span>
              )}
            </PressableCard>
          ))}
        </div>
      )}

      <TrackSection
        title="もう一度聴く"
        tracks={recent}
        onPlayAll={playQueue}
        onMenu={trackMenu}
        onOpenMenu={menu.openAt}
        onOpenArtist={openArtist}
      />

      {mixes.map((mix) => (
        <TrackSection
          key={mix.seed.id}
          title={`${mix.seed.artist} に基づくミックス`}
          hint="聴いた跡から選んだ種"
          tracks={mix.tracks}
          onPlayAll={playQueue}
          onMenu={trackMenu}
          onOpenMenu={menu.openAt}
          onOpenArtist={openArtist}
        />
      ))}

      <NewReleases
        follows={follows}
        nodeOnline={nodeOnline}
        onNavigate={onNavigate}
        onMenu={collectionMenu}
        onOpenMenu={menu.openAt}
      />

      <TrackSection
        title="また聴きたい頃"
        hint="よく聴いていたが、しばらく開いていないもの"
        tracks={forgotten}
        onPlayAll={playQueue}
        onMenu={trackMenu}
        onOpenMenu={menu.openAt}
        onOpenArtist={openArtist}
      />

      <TrackSection
        title="じっくり聴く"
        hint="長めの一本"
        tracks={longOnes}
        onPlayAll={playQueue}
        onMenu={trackMenu}
        onOpenMenu={menu.openAt}
        onOpenArtist={openArtist}
      />

      {recap && <RecapCard recap={recap} onOpenArtist={openArtist} onPlayAll={playQueue} />}

      {follows.length > 0 && (
        <Section title="フォロー中">
          {follows.map((artist) => (
            <Card
              key={artist.id}
              seed={artist.id}
              title={artist.name}
              subtitle="アーティスト"
              artworkUrl={artist.artworkUrl}
              round
              onClick={() => openArtist(artist.id, artist.name)}
              menuItems={collectionMenu({
                kind: "artist",
                id: artist.id,
                title: artist.name,
                ...(artist.artworkUrl ? { artworkUrl: artist.artworkUrl } : {}),
                onOpen: () => openArtist(artist.id, artist.name),
              })}
              onOpenMenu={menu.openAt}
            />
          ))}
        </Section>
      )}

      {/* いちばん外側。自分の跡とは関係なく、広い世界を見せる。 */}
      {discover.map((section) => (
        <Section key={section.title} title={section.title}>
          {section.items.slice(0, 12).map((item, index) =>
            item.type === "track" ? (
              <Card
                key={`${item.track.id}-${index}`}
                seed={item.track.id}
                title={item.track.title}
                // 演奏者が分からない札には、供給元が添えた副題 (再生回数など) を出す。
                {...(item.subtitle
                  ? { subtitle: item.subtitle }
                  : {
                      subtitleLink: {
                        label: item.track.artist,
                        ...(item.track.artistId
                          ? { onOpen: () => openArtist(item.track.artistId!, item.track.artist) }
                          : {}),
                      },
                    })}
                artworkUrl={item.track.artworkUrl}
                onClick={() => playQueue([item.track], 0)}
                onPlay={() => playQueue([item.track], 0)}
                menuItems={trackMenu(item.track, () => playQueue([item.track], 0))}
                onOpenMenu={menu.openAt}
              />
            ) : (
              <Card
                key={`${item.id}-${index}`}
                seed={item.id}
                title={item.title}
                /*
                 * 供給元が添える副題は、作り手の名前だったり回数だったりする。
                 * 名前なら押してその人の場所へ行けるようにする。
                 * 識別子は来ないので、名前で探して辿る。
                 */
                {...(item.subtitle
                  ? {
                      subtitleLink: {
                        label: item.subtitle,
                        onOpen: () => void openByName(item.subtitle!, onNavigate),
                      },
                    }
                  : { subtitle: item.type === "album" ? "アルバム" : "プレイリスト" })}
                artworkUrl={item.artworkUrl}
                onClick={() =>
                  openCollection(
                    item.type === "album" ? "album" : "playlist",
                    item.id,
                    item.title,
                  )
                }
                menuItems={collectionMenu({
                  kind: item.type === "album" ? "album" : "playlist",
                  id: item.id,
                  title: item.title,
                  ...(item.artworkUrl ? { artworkUrl: item.artworkUrl } : {}),
                  onOpen: () =>
                    openCollection(
                      item.type === "album" ? "album" : "playlist",
                      item.id,
                      item.title,
                    ),
                })}
                onOpenMenu={menu.openAt}
              />
            ),
          )}
        </Section>
      ))}

      {menu.node}
    </div>
  );
}

/* ------------------------------ 部品 ------------------------------ */

function TrackSection({
  title,
  hint,
  tracks,
  onPlayAll,
  onMenu,
  onOpenMenu,
  onOpenArtist,
}: {
  title: string;
  hint?: string;
  tracks: Track[];
  onPlayAll: (tracks: Track[], index: number) => void;
  onMenu: (track: Track, onPlay: () => void) => () => MenuItem[];
  onOpenMenu: (x: number, y: number, items: MenuItem[]) => void;
  /** 副題の演奏者を押したときの行き先。識別子が無い曲では出さない。 */
  onOpenArtist?: (id: string, name: string) => void;
}) {
  if (tracks.length === 0) return null;
  return (
    <section className="animate-rise mt-8">
      <div className="mb-4 flex items-baseline justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold tracking-tight sm:text-2xl">{title}</h2>
          {hint && <p className="mt-0.5 text-xs text-ink-faint">{hint}</p>}
        </div>
        <button
          type="button"
          onClick={() => onPlayAll(tracks, 0)}
          className="press shrink-0 rounded-full bg-surface-3 px-4 py-1.5 text-xs font-medium text-ink-muted transition hover:text-ink"
        >
          再生
        </button>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-5 xl:grid-cols-6">
        {tracks.map((track, index) => (
          <Card
            key={`${track.id}-${index}`}
            seed={track.id}
            title={track.title}
            subtitleLink={{
              label: track.artist,
              ...(track.artistId && onOpenArtist
                ? { onOpen: () => onOpenArtist(track.artistId!, track.artist) }
                : {}),
            }}
            artworkUrl={track.artworkUrl}
            onClick={() => onPlayAll(tracks, index)}
            onPlay={() => onPlayAll(tracks, index)}
            menuItems={onMenu(track, () => onPlayAll(tracks, index))}
            onOpenMenu={onOpenMenu}
          />
        ))}
      </div>
    </section>
  );
}

function RecapCard({
  recap,
  onOpenArtist,
  onPlayAll,
}: {
  recap: Recap;
  onOpenArtist: (id: string, name: string) => void;
  onPlayAll: (tracks: Track[], index: number) => void;
}) {
  return (
    <section className="animate-rise mt-8 overflow-hidden rounded-lg bg-surface p-5 sm:p-6">
      <div className="flex items-center gap-2 text-xs font-semibold text-accent">
        <Sparkles className="size-4" />
        {recap.label}
      </div>
      <div className="mt-3 flex flex-wrap items-baseline gap-x-6 gap-y-1">
        <span className="text-3xl font-black tracking-tight">
          {formatListeningTime(recap.totalMs)}
        </span>
        <span className="text-sm text-ink-muted">{recap.trackCount} 回の再生</span>
      </div>

      {recap.topArtists.length > 0 && (
        <div className="mt-5">
          <div className="mb-2 text-xs font-semibold text-ink-faint">よく聴いた人</div>
          <div className="flex flex-wrap gap-2">
            {recap.topArtists.map((artist) => (
              <button
                key={artist.name}
                type="button"
                onClick={() => artist.id && onOpenArtist(artist.id, artist.name)}
                disabled={!artist.id}
                className="press flex items-center gap-2 rounded-full bg-surface-2 py-1 pr-3 pl-1 text-sm transition hover:bg-surface-3 disabled:cursor-default"
              >
                <Artwork
                  seed={artist.name}
                  label={artist.name}
                  src={artist.artworkUrl}
                  className="size-7"
                  rounded="rounded-full"
                />
                <span className="max-w-[10rem] truncate">{artist.name}</span>
                <span className="text-xs text-ink-faint">{artist.count}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {recap.topTracks.length > 0 && (
        <button
          type="button"
          onClick={() => onPlayAll(recap.topTracks, 0)}
          className="press mt-5 flex items-center gap-2 rounded-full bg-accent px-5 py-2.5 text-sm font-semibold text-accent-ink transition hover:brightness-110"
        >
          <Play className="size-4 fill-current" />
          この期間のトップを流す
        </button>
      )}
    </section>
  );
}

function NewReleases({
  follows,
  nodeOnline,
  onNavigate,
  onMenu,
  onOpenMenu,
}: {
  follows: { id: string; name: string }[];
  nodeOnline: boolean;
  onNavigate: (route: Route) => void;
  onMenu: (target: CollectionMenuTarget) => () => MenuItem[];
  onOpenMenu: (x: number, y: number, items: MenuItem[]) => void;
}) {
  const releases = useFollowedReleases(follows, nodeOnline);
  if (releases.length === 0) return null;

  return (
    <Section title="フォロー中の新着">
      {releases.map((release) => {
        const open = () =>
          onNavigate({
            name: "collection",
            kind: "album",
            id: release.id,
            title: release.title,
          });
        return (
          <Card
            key={release.id}
            seed={release.id}
            title={release.title}
            {...(release.year ? { subtitle: release.year } : {})}
            subtitleLink={{
              label: release.artist,
              ...(release.artistId
                ? {
                    onOpen: () =>
                      onNavigate({
                        name: "collection",
                        kind: "artist",
                        id: release.artistId!,
                        title: release.artist,
                      }),
                  }
                : {}),
            }}
            artworkUrl={release.artworkUrl}
            onClick={open}
            menuItems={onMenu({
              kind: "album",
              id: release.id,
              title: release.title,
              ...(release.artworkUrl ? { artworkUrl: release.artworkUrl } : {}),
              onOpen: open,
            })}
            onOpenMenu={onOpenMenu}
          />
        );
      })}
    </Section>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="animate-rise mt-8">
      <h2 className="mb-4 text-xl font-bold tracking-tight sm:text-2xl">{title}</h2>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-5 xl:grid-cols-6">
        {children}
      </div>
    </section>
  );
}

function Card({
  seed,
  title,
  subtitle,
  artworkUrl,
  round = false,
  onClick,
  onPlay,
  subtitleLink,
  menuItems,
  onOpenMenu,
}: {
  seed: string;
  title: string;
  subtitle?: string;
  artworkUrl?: string;
  round?: boolean;
  onClick: () => void;
  onPlay?: () => void;
  /**
   * 副題の末尾に置く、押せる名前。
   *
   * 札そのものを押せば曲が鳴るが、名前を見て
   * 「この人の他の曲」へ行きたくなることがある。
   */
  subtitleLink?: { label: string; onOpen?: () => void };
  menuItems?: () => MenuItem[];
  onOpenMenu?: (x: number, y: number, items: MenuItem[]) => void;
}) {
  return (
    <PressableCard
      onClick={onClick}
      {...(menuItems ? { menuItems } : {})}
      {...(onOpenMenu ? { onOpenMenu } : {})}
      className="press group relative min-w-0 rounded-lg bg-surface p-3 text-left transition hover:bg-surface-3 sm:p-4"
    >
      <div className="relative">
        <Artwork
          seed={seed}
          label={title}
          src={artworkUrl}
          className="aspect-square w-full text-4xl sm:text-5xl"
          rounded={round ? "rounded-full" : "rounded-md"}
        />
        {onPlay && (
          <span
            onClick={(event) => {
              event.stopPropagation();
              onPlay();
            }}
            className="absolute right-2 bottom-2 grid size-10 translate-y-2 place-items-center rounded-full bg-accent text-accent-ink opacity-0 shadow-xl transition group-hover:translate-y-0 group-hover:opacity-100 sm:size-11"
          >
            <Play className="size-4 translate-x-px fill-current" />
          </span>
        )}
      </div>
      <div className="mt-3 truncate text-sm font-semibold">{title}</div>
      {(subtitle || subtitleLink) && (
        <div className="mt-1 truncate text-xs text-ink-muted">
          {subtitle}
          {subtitle && subtitleLink && " · "}
          {subtitleLink && (
            <LinkedName
              label={subtitleLink.label}
              {...(subtitleLink.onOpen ? { onOpen: subtitleLink.onOpen } : {})}
            />
          )}
        </div>
      )}
    </PressableCard>
  );
}

/* ------------------------------ 取得 ------------------------------ */

interface Mix {
  seed: Track;
  tracks: Track[];
}

/** 聴いた跡から選んだ種で、続けて流す曲を組む。 */
function useMixes(seeds: Track[], nodeOnline: boolean): Mix[] {
  const [mixes, setMixes] = useState<Mix[]>([]);

  useEffect(() => {
    if (!nodeOnline || seeds.length === 0) return;
    let cancelled = false;

    void Promise.all(
      seeds.map(async (seed) => {
        try {
          const { tracks } = await nodeRadio(seed.id, 12);
          // 先頭は種そのものなので外す。同じ曲が並ぶと勧められた感じが薄い。
          return { seed, tracks: tracks.filter((t) => t.id !== seed.id) };
        } catch {
          return null;
        }
      }),
    ).then((results) => {
      if (cancelled) return;
      setMixes(results.filter((m): m is Mix => m !== null && m.tracks.length > 0));
    });

    return () => {
      cancelled = true;
    };
  }, [nodeOnline, seeds.map((s) => s.id).join(",")]);

  return mixes;
}

interface Release {
  id: string;
  title: string;
  artist: string;
  /** 名前を押してその人の場所へ行くための識別子。 */
  artistId?: string;
  year?: string;
  artworkUrl?: string;
}

/** フォローしている人の、新しいリリースを集める。 */
function useFollowedReleases(
  follows: { id: string; name: string }[],
  nodeOnline: boolean,
): Release[] {
  const [releases, setReleases] = useState<Release[]>([]);

  useEffect(() => {
    if (!nodeOnline || follows.length === 0) return;
    let cancelled = false;

    // 全員分を一度に引くと待ちが長い。手前の数人で足りる。
    const targets = follows.slice(0, 4);

    void Promise.all(
      targets.map(async (artist) => {
        try {
          const page = await nodeCollection("artist", artist.id);
          return [...(page.singles ?? []), ...(page.albums ?? [])].map((release) => ({
            id: release.id,
            title: release.title,
            artist: release.artist || artist.name,
            // 誰を追っていて出てきたものかは分かっている。そこへ飛ばせる。
            artistId: release.artistId ?? artist.id,
            year: release.year,
            artworkUrl: release.artworkUrl,
          }));
        } catch {
          return [];
        }
      }),
    ).then((lists) => {
      if (cancelled) return;
      const merged = lists.flat();
      merged.sort((a, b) => Number(b.year ?? 0) - Number(a.year ?? 0));
      // 同じものが両方に入っていることがあるので、識別子で間引く。
      const seen = new Set<string>();
      setReleases(merged.filter((r) => !seen.has(r.id) && seen.add(r.id)).slice(0, 12));
    });

    return () => {
      cancelled = true;
    };
  }, [nodeOnline, follows.map((f) => f.id).join(",")]);

  return releases;
}

/** 地域向けの汎用のおすすめ。 */
function useDiscover(nodeOnline: boolean): DiscoverSection[] {
  const [sections, setSections] = useState<DiscoverSection[]>([]);

  useEffect(() => {
    if (!nodeOnline) return;
    let cancelled = false;

    void nodeDiscover()
      .then((result) => {
        if (!cancelled) setSections(result.sections);
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [nodeOnline]);

  return sections;
}

function greetingForNow(): string {
  const hour = new Date().getHours();
  if (hour < 5) return "こんばんは";
  if (hour < 11) return "おはようございます";
  if (hour < 18) return "こんにちは";
  return "こんばんは";
}
