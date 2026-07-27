import { Home, Library, Plus, Search, Users } from "lucide-react";
import type { Group, Playlist } from "@musicshare/shared";
import { Artwork } from "./Artwork.js";
import type { Route } from "../lib/routes.js";

interface Props {
  route: Route;
  onNavigate: (route: Route) => void;
  playlists: Playlist[];
  groups: Group[];
}

export function Sidebar({ route, onNavigate, playlists, groups }: Props) {
  const groupName = (groupId: string | undefined) =>
    groupId ? groups.find((g) => g.id === groupId)?.name : undefined;

  return (
    <nav className="flex h-full w-[260px] shrink-0 flex-col gap-2">
      <div className="rounded-lg bg-surface p-2">
        <div className="px-3 pt-3 pb-4">
          <span className="text-lg font-bold tracking-tight">musicshare</span>
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
          <button
            type="button"
            className="flex items-center gap-3 text-sm font-semibold text-ink-muted transition hover:text-ink"
            onClick={() => onNavigate({ name: "home" })}
          >
            <Library className="size-5" />
            ライブラリ
          </button>
          <button
            type="button"
            className="grid size-8 place-items-center rounded-full text-ink-muted transition hover:bg-surface-3 hover:text-ink"
            aria-label="プレイリストを作成"
          >
            <Plus className="size-4" />
          </button>
        </div>

        <div className="no-scrollbar scroll-area min-h-0 flex-1 px-2 pb-2">
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
                <Artwork seed={playlist.id} label={playlist.name} className="size-11" />
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium">{playlist.name}</span>
                  <span className="block truncate text-xs text-ink-muted">
                    {shared ? `共有 · ${shared}` : "プレイリスト"}
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
