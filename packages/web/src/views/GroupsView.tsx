import { useState } from "react";
import { Copy, LogOut, Plus, Radio, Users } from "lucide-react";
import { Artwork } from "../components/Artwork.js";
import { useLibrary } from "../lib/library-store.js";
import { useSession } from "../lib/session-store.js";
import type { Route } from "../lib/routes.js";

interface Props {
  onNavigate: (route: Route) => void;
}

export function GroupsView({ onNavigate }: Props) {
  const { groups, playlists, user, createGroup, joinGroup, leaveGroup } = useLibrary();
  const startSession = useSession((s) => s.startForGroup);
  const [mode, setMode] = useState<"none" | "create" | "join">("none");
  const [value, setValue] = useState("");
  const [copied, setCopied] = useState<string | null>(null);

  const submit = async () => {
    const input = value.trim();
    if (!input) return;
    if (mode === "create") await createGroup(input);
    else await joinGroup(input);
    setValue("");
    setMode("none");
  };

  const copyCode = async (code: string) => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(code);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      // 書き込めない環境では見せるだけで足りる。
    }
  };

  return (
    <div className="px-4 pt-20 pb-8 sm:px-6">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">グループ</h1>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setMode(mode === "join" ? "none" : "join")}
            className="shrink-0 rounded-full bg-surface-3 px-4 py-2 text-sm font-medium transition hover:bg-line"
          >
            参加
          </button>
          <button
            type="button"
            onClick={() => setMode(mode === "create" ? "none" : "create")}
            className="flex shrink-0 items-center gap-2 rounded-full bg-surface-3 px-4 py-2 text-sm font-medium transition hover:bg-line"
          >
            <Plus className="size-4" />
            作る
          </button>
        </div>
      </div>

      {mode !== "none" && (
        <div className="mt-4 flex gap-2">
          <input
            value={value}
            onChange={(event) =>
              setValue(mode === "join" ? event.target.value.toUpperCase() : event.target.value)
            }
            onKeyDown={(event) => event.key === "Enter" && void submit()}
            placeholder={mode === "create" ? "グループ名" : "合言葉 (6文字)"}
            autoFocus
            autoCapitalize={mode === "join" ? "characters" : "off"}
            className="min-w-0 flex-1 rounded-lg bg-surface-3 px-4 py-2.5 text-sm outline-none placeholder:text-ink-faint focus:ring-2 focus:ring-accent/40"
          />
          <button
            type="button"
            onClick={() => void submit()}
            disabled={value.trim().length === 0}
            className="shrink-0 rounded-full bg-accent px-5 text-sm font-semibold text-accent-ink disabled:opacity-40"
          >
            {mode === "create" ? "作る" : "参加"}
          </button>
        </div>
      )}

      {groups.length === 0 ? (
        <p className="mt-10 text-sm text-ink-faint">
          グループを作ると、友だちとプレイリストを共有して一緒に聴けます。
        </p>
      ) : (
        <div className="mt-6 space-y-4">
          {groups.map((group) => {
            const shared = playlists.filter((p) => p.groupId === group.id);
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
                          {group.members.map((m) => m.displayName).join("、")}
                        </span>
                      </div>
                      {/* 誘うときはこの合言葉を渡す。 */}
                      <button
                        type="button"
                        onClick={() => void copyCode(group.inviteCode)}
                        className="mt-2 flex items-center gap-1.5 rounded-full bg-surface-3 px-2.5 py-1 font-mono text-xs tracking-widest text-ink-muted transition hover:text-ink"
                        title="合言葉をコピー"
                      >
                        {group.inviteCode}
                        <Copy className="size-3" />
                        {copied === group.inviteCode && (
                          <span className="font-sans tracking-normal text-accent">コピー済み</span>
                        )}
                      </button>
                    </div>
                  </div>

                  <div className="flex shrink-0 gap-2">
                    <button
                      type="button"
                      onClick={() => void startSession(group.id)}
                      className="flex flex-1 items-center justify-center gap-2 rounded-full bg-accent px-4 py-2.5 text-sm font-semibold text-accent-ink transition hover:brightness-110 sm:flex-none sm:py-2"
                    >
                      <Radio className="size-4" />
                      一緒に聴く
                    </button>
                    <button
                      type="button"
                      onClick={() => void leaveGroup(group.id)}
                      className="grid size-10 shrink-0 place-items-center rounded-full text-ink-faint transition hover:text-ink"
                      aria-label="グループから抜ける"
                      title="グループから抜ける"
                    >
                      <LogOut className="size-4" />
                    </button>
                  </div>
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
                          <Artwork
                            seed={playlist.id}
                            label={playlist.name}
                            src={playlist.tracks[0]?.artworkUrl}
                            className="size-10"
                          />
                          <div className="min-w-0">
                            <div className="truncate text-sm font-medium">{playlist.name}</div>
                            <div className="truncate text-xs text-ink-muted">
                              {playlist.tracks.length} 曲
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
      )}

      {user && (
        <p className="mt-8 text-xs text-ink-faint">
          サインイン中: {user.displayName}
        </p>
      )}
    </div>
  );
}
