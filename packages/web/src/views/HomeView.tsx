import { Play, Search } from "lucide-react";
import { Artwork } from "../components/Artwork.js";
import { useLibrary } from "../lib/library-store.js";
import { usePlayer } from "../lib/player-store.js";
import type { Route } from "../lib/routes.js";

interface Props {
  onNavigate: (route: Route) => void;
}

export function HomeView({ onNavigate }: Props) {
  const { playlists, groups, follows, user } = useLibrary();
  const playQueue = usePlayer((s) => s.playQueue);

  // 中身のあるものを先に出す。空の並びを上に置いても手掛かりにならない。
  const filled = [...playlists].sort((a, b) => b.tracks.length - a.tracks.length);
  const recent = [...playlists].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

  if (playlists.length === 0) {
    return (
      <div className="px-4 pt-20 pb-8 sm:px-6">
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
          {greetingForNow()}
          {user ? `、${user.displayName}` : ""}
        </h1>
        <div className="mt-8 rounded-lg bg-surface p-6">
          <h2 className="text-lg font-semibold">まずは一曲さがす</h2>
          <p className="mt-2 text-sm text-ink-muted">
            検索して曲の行の ＋ を押すと、プレイリストに入れられます。
            グループを作れば、その中で友だちと共有できます。
          </p>
          <button
            type="button"
            onClick={() => onNavigate({ name: "search" })}
            className="mt-5 flex items-center gap-2 rounded-full bg-accent px-5 py-2.5 text-sm font-semibold text-accent-ink transition hover:brightness-110"
          >
            <Search className="size-4" />
            検索へ
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="px-4 pt-20 pb-8 sm:px-6">
      <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
        {greetingForNow()}
        {user ? `、${user.displayName}` : ""}
      </h1>

      {/*
       * 横長タイル。よく開くものへの近道。
       * 狭い画面で 2 列に詰めると、名前が 1 文字まで削られて用をなさない。
       */}
      <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {filled.slice(0, 6).map((playlist) => (
          <button
            key={playlist.id}
            type="button"
            onClick={() => onNavigate({ name: "playlist", playlistId: playlist.id })}
            className="group flex items-center gap-3 overflow-hidden rounded-md bg-surface-2 pr-3 text-left transition hover:bg-surface-3"
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
          </button>
        ))}
      </div>

      <Section title="最近さわったもの">
        {recent.map((playlist) => {
          const group = playlist.groupId
            ? groups.find((g) => g.id === playlist.groupId)
            : undefined;
          return (
            <Card
              key={playlist.id}
              seed={playlist.id}
              title={playlist.name}
              subtitle={group ? `共有 · ${group.name}` : `${playlist.tracks.length} 曲`}
              artworkUrl={playlist.tracks[0]?.artworkUrl}
              onClick={() => onNavigate({ name: "playlist", playlistId: playlist.id })}
              onPlay={() => playQueue(playlist.tracks, 0)}
            />
          );
        })}
      </Section>

      {/* 気に入った人をここにも出す。次に何を聴くかの手掛かりになる。 */}
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
              onClick={() =>
                onNavigate({
                  name: "collection",
                  kind: "artist",
                  id: artist.id,
                  title: artist.name,
                })
              }
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

function Card({
  seed,
  title,
  subtitle,
  artworkUrl,
  round = false,
  onClick,
  onPlay,
}: {
  seed: string;
  title: string;
  subtitle: string;
  artworkUrl?: string;
  round?: boolean;
  onClick: () => void;
  onPlay?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group relative min-w-0 rounded-lg bg-surface p-3 text-left transition hover:bg-surface-3 sm:p-4"
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
      <div className="mt-1 truncate text-xs text-ink-muted">{subtitle}</div>
    </button>
  );
}

function greetingForNow(): string {
  const hour = new Date().getHours();
  if (hour < 5) return "こんばんは";
  if (hour < 11) return "おはようございます";
  if (hour < 18) return "こんにちは";
  return "こんばんは";
}
