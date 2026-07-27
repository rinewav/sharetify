import { Plus, Radio, Users } from "lucide-react";
import type { Group, Playlist } from "@musicshare/shared";
import { Artwork } from "../components/Artwork.js";
import { mockUsers } from "../lib/mock.js";
import { useSession, type Participant } from "../lib/session-store.js";
import type { Route } from "../lib/routes.js";

interface Props {
  groups: Group[];
  playlists: Playlist[];
  onNavigate: (route: Route) => void;
}

export function GroupsView({ groups, playlists, onNavigate }: Props) {
  const startMockSession = useSession((s) => s.startMockSession);

  return (
    <div className="px-4 pt-20 pb-8 sm:px-6">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">グループ</h1>
        <button
          type="button"
          className="flex shrink-0 items-center gap-2 rounded-full bg-surface-3 px-4 py-2 text-sm font-medium transition hover:bg-line"
        >
          <Plus className="size-4" />
          <span className="hidden sm:inline">グループを作る</span>
          <span className="sm:hidden">作る</span>
        </button>
      </div>

      <div className="mt-6 space-y-4">
        {groups.map((group) => {
          const shared = playlists.filter((p) => p.groupId === group.id);
          const members = group.memberIds
            .map((id) => mockUsers.find((u) => u.id === id))
            .filter((u): u is (typeof mockUsers)[number] => u !== undefined);

          return (
            <section key={group.id} className="rounded-lg bg-surface p-4 sm:p-5">
              <div className="flex flex-col items-stretch gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div className="flex min-w-0 items-center gap-4">
                  <Artwork
                    seed={group.id}
                    label={group.name}
                    className="size-16 text-2xl"
                    rounded="rounded-md"
                  />
                  <div className="min-w-0">
                    <h2 className="truncate text-lg font-bold sm:text-xl">{group.name}</h2>
                    <div className="mt-1 flex items-center gap-1.5 text-sm text-ink-muted">
                      <Users className="size-4 shrink-0" />
                      <span className="truncate">
                        {members.map((m) => m.displayName).join("、")}
                      </span>
                    </div>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => startMockSession(mockParticipants(members))}
                  className="flex shrink-0 items-center justify-center gap-2 rounded-full bg-accent px-4 py-2.5 text-sm font-semibold text-accent-ink transition hover:brightness-110 sm:py-2"
                >
                  <Radio className="size-4" />
                  一緒に聴く
                </button>
              </div>

              {shared.length > 0 && (
                <div className="mt-5">
                  <div className="mb-3 text-xs font-semibold text-ink-muted">
                    共有プレイリスト
                  </div>
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                    {shared.map((playlist) => (
                      <button
                        key={playlist.id}
                        type="button"
                        onClick={() =>
                          onNavigate({ name: "playlist", playlistId: playlist.id })
                        }
                        className="flex items-center gap-3 rounded-md bg-surface-2 p-2 text-left transition hover:bg-surface-3"
                      >
                        <Artwork seed={playlist.id} label={playlist.name} className="size-10" />
                        <div className="min-w-0">
                          <div className="truncate text-sm font-medium">{playlist.name}</div>
                          <div className="truncate text-xs text-ink-muted">
                            {playlist.trackIds.length} 曲
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}

/**
 * 仮のセッション参加者。
 * 全員が同じ曲を用意できるとは限らないので、準備中の人がいる状態も見せておく。
 */
function mockParticipants(members: { id: string; displayName: string }[]): Participant[] {
  return members.map((member, index) => ({
    userId: member.id,
    displayName: member.displayName,
    isHost: index === 0,
    ready: index !== members.length - 1,
    reason: index === members.length - 1 ? "PC がオフラインです" : undefined,
  }));
}
