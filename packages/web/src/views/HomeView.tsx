import { Play } from "lucide-react";
import type { Playlist } from "@musicshare/shared";
import { Artwork } from "../components/Artwork.js";
import { mockTracks, tracksOf } from "../lib/mock.js";
import { usePlayer } from "../lib/player-store.js";
import type { Route } from "../lib/routes.js";

interface Props {
  playlists: Playlist[];
  onNavigate: (route: Route) => void;
}

export function HomeView({ playlists, onNavigate }: Props) {
  const playQueue = usePlayer((s) => s.playQueue);
  const greeting = greetingForNow();

  return (
    <div className="px-6 pt-20 pb-8">
      <h1 className="text-3xl font-bold tracking-tight">{greeting}</h1>

      {/* 横長タイル。よく開くものへの近道。 */}
      <div className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-3">
        {playlists.slice(0, 6).map((playlist) => (
          <button
            key={playlist.id}
            type="button"
            onClick={() => onNavigate({ name: "playlist", playlistId: playlist.id })}
            className="group flex items-center gap-3 overflow-hidden rounded-md bg-surface-2 pr-3 text-left transition hover:bg-surface-3"
          >
            <Artwork
              seed={playlist.id}
              label={playlist.name}
              className="size-16 text-2xl"
              rounded="rounded-none"
            />
            <span className="min-w-0 flex-1 truncate text-sm font-semibold">
              {playlist.name}
            </span>
            <span
              onClick={(event) => {
                event.stopPropagation();
                playQueue(tracksOf(playlist), 0);
              }}
              className="grid size-10 shrink-0 translate-y-1 place-items-center rounded-full bg-accent text-accent-ink opacity-0 shadow-lg transition group-hover:translate-y-0 group-hover:opacity-100"
            >
              <Play className="size-4 translate-x-px fill-current" />
            </span>
          </button>
        ))}
      </div>

      <Section title="最近聴いたもの">
        {playlists.map((playlist) => (
          <Card
            key={playlist.id}
            seed={playlist.id}
            title={playlist.name}
            subtitle={playlist.description ?? `${playlist.trackIds.length} 曲`}
            onClick={() => onNavigate({ name: "playlist", playlistId: playlist.id })}
            onPlay={() => playQueue(tracksOf(playlist), 0)}
          />
        ))}
      </Section>

      <Section title="よく聴くアーティスト">
        {uniqueArtists().map((artist) => (
          <Card
            key={artist}
            seed={artist}
            title={artist}
            subtitle="アーティスト"
            round
            onClick={() => onNavigate({ name: "search" })}
            onPlay={() =>
              playQueue(
                mockTracks.filter((t) => t.artist === artist),
                0,
              )
            }
          />
        ))}
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-8">
      <h2 className="mb-4 text-2xl font-bold tracking-tight">{title}</h2>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-6">
        {children}
      </div>
    </section>
  );
}

function Card({
  seed,
  title,
  subtitle,
  onClick,
  onPlay,
  round = false,
}: {
  seed: string;
  title: string;
  subtitle: string;
  onClick: () => void;
  onPlay: () => void;
  round?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group relative rounded-lg bg-surface p-4 text-left transition hover:bg-surface-3"
    >
      <div className="relative">
        <Artwork
          seed={seed}
          label={title}
          className="aspect-square w-full text-5xl"
          rounded={round ? "rounded-full" : "rounded-md"}
        />
        <span
          onClick={(event) => {
            event.stopPropagation();
            onPlay();
          }}
          className="absolute right-2 bottom-2 grid size-11 translate-y-2 place-items-center rounded-full bg-accent text-accent-ink opacity-0 shadow-xl transition group-hover:translate-y-0 group-hover:opacity-100"
        >
          <Play className="size-4 translate-x-px fill-current" />
        </span>
      </div>
      <div className="mt-3 truncate text-sm font-semibold">{title}</div>
      <div className="mt-1 truncate text-xs text-ink-muted">{subtitle}</div>
    </button>
  );
}

function uniqueArtists(): string[] {
  return [...new Set(mockTracks.map((t) => t.artist))];
}

function greetingForNow(): string {
  const hour = new Date().getHours();
  if (hour < 5) return "こんばんは";
  if (hour < 11) return "おはようございます";
  if (hour < 18) return "こんにちは";
  return "こんばんは";
}
