import { useState } from "react";
import { Check, Plus, Users, X } from "lucide-react";
import type { Track } from "@musicshare/shared";
import { Artwork } from "./Artwork.js";
import { Sheet } from "./Sheet.js";
import { useLibrary } from "../lib/library-store.js";

interface Props {
  track: Track;
  onClose: () => void;
}

/** 曲をどの並びに入れるか選ぶ。新しく作ってそこへ入れることもできる。 */
export function AddToPlaylistSheet({ track, onClose }: Props) {
  const { playlists, groups, addTrack, createPlaylist } = useLibrary();
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [added, setAdded] = useState<string | null>(null);

  const put = async (playlistId: string) => {
    await addTrack(playlistId, track);
    setAdded(playlistId);
    // 入れたことが見えるよう少しだけ残してから閉じる。
    setTimeout(onClose, 500);
  };

  const createAndPut = async () => {
    const name = newName.trim();
    if (!name) return;
    const playlist = await createPlaylist({ name });
    if (playlist) await put(playlist.id);
  };

  return (
    <Sheet onClose={onClose} className="max-h-[70vh] max-w-sm">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 className="text-lg font-bold">プレイリストに追加</h2>
            <p className="mt-1 truncate text-xs text-ink-muted">{track.title}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 text-ink-muted transition hover:text-ink"
            aria-label="閉じる"
          >
            <X className="size-5" />
          </button>
        </div>

        <div className="scroll-area mt-4 min-h-0 flex-1">
          {playlists.length === 0 && !creating && (
            <p className="py-6 text-center text-sm text-ink-faint">まだ何もありません。</p>
          )}

          {playlists.map((playlist) => {
            const group = playlist.groupId
              ? groups.find((g) => g.id === playlist.groupId)
              : undefined;
            return (
              <button
                key={playlist.id}
                type="button"
                onClick={() => void put(playlist.id)}
                className="flex w-full items-center gap-3 rounded-md p-2 text-left transition hover:bg-surface-2"
              >
                <Artwork
                  seed={playlist.id}
                  label={playlist.name}
                  src={playlist.tracks[0]?.artworkUrl}
                  className="size-10"
                />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm">{playlist.name}</div>
                  <div className="flex items-center gap-1 truncate text-xs text-ink-muted">
                    {group && <Users className="size-3" />}
                    {group ? group.name : `${playlist.tracks.length} 曲`}
                  </div>
                </div>
                {added === playlist.id && <Check className="size-4 shrink-0 text-accent" />}
              </button>
            );
          })}
        </div>

        {creating ? (
          <div className="mt-3 flex gap-2">
            <input
              value={newName}
              onChange={(event) => setNewName(event.target.value.slice(0, 40))}
              onKeyDown={(event) => event.key === "Enter" && void createAndPut()}
              placeholder="新しいプレイリスト名"
              autoFocus
              className="min-w-0 flex-1 rounded-lg bg-surface-3 px-3 py-2 text-sm outline-none placeholder:text-ink-faint focus:ring-2 focus:ring-accent/40"
            />
            <button
              type="button"
              onClick={() => void createAndPut()}
              disabled={newName.trim().length === 0}
              className="shrink-0 rounded-full bg-accent px-4 text-sm font-semibold text-accent-ink disabled:opacity-40"
            >
              作る
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="mt-3 flex w-full items-center justify-center gap-2 rounded-full border border-line py-2.5 text-sm text-ink-muted transition hover:border-ink-muted hover:text-ink"
          >
            <Plus className="size-4" />
            新しいプレイリストを作る
          </button>
        )}
    </Sheet>
  );
}
