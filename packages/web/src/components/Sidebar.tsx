import { useState } from "react";
import { Download, Heart, Home, Library, Plus, Search, Users } from "lucide-react";
import { Artwork } from "./Artwork.js";
import { ImportPlaylistSheet } from "./ImportPlaylistSheet.js";
import { useLibrary } from "../lib/library-store.js";
import type { Route } from "../lib/routes.js";

interface Props {
  route: Route;
  onNavigate: (route: Route) => void;
}

export function Sidebar({ route, onNavigate }: Props) {
  const { playlists, groups, follows, likes, createPlaylist } = useLibrary();
  const [creating, setCreating] = useState(false);
  const [importing, setImporting] = useState(false);
  const [name, setName] = useState("");

  const groupName = (groupId: string | undefined) =>
    groupId ? groups.find((g) => g.id === groupId)?.name : undefined;

  const submit = async () => {
    const value = name.trim();
    if (!value) return;
    const created = await createPlaylist({ name: value });
    setName("");
    setCreating(false);
    if (created) onNavigate({ name: "playlist", playlistId: created.id });
  };

  return (
    <nav className="app-no-drag flex h-full w-[260px] shrink-0 flex-col gap-2">
      <div className="rounded-lg bg-surface p-2">
        <div className="app-drag px-3 pt-3 pb-4">
          <span className="flex items-center gap-2.5">
            <img
              src="/icons/icon-192.png"
              alt=""
              className="size-7 rounded-md"
              width={28}
              height={28}
            />
            <span className="text-lg font-bold tracking-tight">Sharetify</span>
          </span>
        </div>
        <NavItem
          icon={<Home className="size-5" />}
          label="ホーム"
          active={route.name === "home"}
          onClick={() => onNavigate({ name: "home" })}
        />
        <NavItem
          icon={<Search className="size-5" />}
          label="検索"
          active={route.name === "search"}
          onClick={() => onNavigate({ name: "search" })}
        />
        <NavItem
          icon={<Users className="size-5" />}
          label="グループ"
          active={route.name === "groups"}
          onClick={() => onNavigate({ name: "groups" })}
        />
      </div>

      <div className="flex min-h-0 flex-1 flex-col rounded-lg bg-surface">
        <div className="flex items-center justify-between px-4 py-3">
          <span className="flex items-center gap-3 text-sm font-semibold text-ink-muted">
            <Library className="size-5" />
            ライブラリ
          </span>
          <span className="flex items-center gap-0.5">
            <button
              type="button"
              onClick={() => setImporting(true)}
              className="grid size-8 place-items-center rounded-full text-ink-muted transition hover:bg-surface-3 hover:text-ink"
              aria-label="プレイリストを取り込む"
              title="よそのプレイリストを取り込む"
            >
              <Download className="size-4" />
            </button>
            <button
              type="button"
              onClick={() => setCreating((open) => !open)}
              className="grid size-8 place-items-center rounded-full text-ink-muted transition hover:bg-surface-3 hover:text-ink"
              aria-label="プレイリストを作成"
            >
              <Plus className="size-4" />
            </button>
          </span>
        </div>

        {importing && (
          <ImportPlaylistSheet
            onClose={() => setImporting(false)}
            onDone={(playlistId) => {
              setImporting(false);
              onNavigate({ name: "playlist", playlistId });
            }}
          />
        )}

        {creating && (
          <div className="px-2 pb-2">
            <input
              value={name}
              onChange={(event) => setName(event.target.value.slice(0, 40))}
              onKeyDown={(event) => {
                if (event.key === "Enter") void submit();
                if (event.key === "Escape") setCreating(false);
              }}
              placeholder="プレイリスト名"
              autoFocus
              className="w-full rounded-md bg-surface-3 px-3 py-2 text-sm outline-none placeholder:text-ink-faint focus:ring-2 focus:ring-accent/40"
            />
          </div>
        )}

        <div className="no-scrollbar scroll-area min-h-0 flex-1 px-2 pb-2">
          {/*
            気に入った曲は、並びより先に置く。
            どこで押した曲もここに溜まるので、いちばん手が伸びる。
          */}
          {likes.length > 0 && (
            <button
              type="button"
              onClick={() => onNavigate({ name: "likes" })}
              className={`flex w-full items-center gap-3 rounded-md p-2 text-left transition ${
                route.name === "likes" ? "bg-surface-3" : "hover:bg-surface-2"
              }`}
            >
              <span className="grid size-11 shrink-0 place-items-center rounded bg-gradient-to-br from-accent to-accent-strong text-accent-ink">
                <Heart className="size-5 fill-current" />
              </span>
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium">お気に入りの曲</span>
                <span className="block truncate text-xs text-ink-muted">{likes.length} 曲</span>
              </span>
            </button>
          )}

          {playlists.length === 0 && follows.length === 0 && likes.length === 0 && !creating && (
            <p className="px-2 py-4 text-xs text-ink-faint">
              まだありません。＋ から作るか、アーティストをフォローしてみてください。
            </p>
          )}

          {/*
            気に入ったアーティストも並びと同じ場所に置く。
            探しに行くのではなく、いつもの場所から開けるように。
          */}
          {follows.map((artist) => {
            const active = route.name === "collection" && route.id === artist.id;
            return (
              <button
                key={artist.id}
                type="button"
                onClick={() =>
                  onNavigate({
                    name: "collection",
                    kind: "artist",
                    id: artist.id,
                    title: artist.name,
                  })
                }
                className={`flex w-full items-center gap-3 rounded-md p-2 text-left transition ${
                  active ? "bg-surface-3" : "hover:bg-surface-2"
                }`}
              >
                <Artwork
                  seed={artist.id}
                  label={artist.name}
                  src={artist.artworkUrl}
                  className="size-11"
                  rounded="rounded-full"
                />
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium">{artist.name}</span>
                  <span className="block truncate text-xs text-ink-muted">アーティスト</span>
                </span>
              </button>
            );
          })}

          {playlists.map((playlist) => {
            const active = route.name === "playlist" && route.playlistId === playlist.id;
            const shared = groupName(playlist.groupId);
            return (
              <button
                key={playlist.id}
                type="button"
                onClick={() => onNavigate({ name: "playlist", playlistId: playlist.id })}
                className={`flex w-full items-center gap-3 rounded-md p-2 text-left transition ${
                  active ? "bg-surface-3" : "hover:bg-surface-2"
                }`}
              >
                <Artwork
                  seed={playlist.id}
                  label={playlist.name}
                  src={playlist.tracks[0]?.artworkUrl}
                  className="size-11"
                />
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium">{playlist.name}</span>
                  <span className="block truncate text-xs text-ink-muted">
                    {shared ? `共有 · ${shared}` : `${playlist.tracks.length} 曲`}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </nav>
  );
}

function NavItem({
  icon,
  label,
  active,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center gap-4 rounded-md px-3 py-2.5 text-sm font-semibold transition ${
        active ? "text-ink" : "text-ink-muted hover:text-ink"
      }`}
    >
      {icon}
      {label}
    </button>
  );
}
