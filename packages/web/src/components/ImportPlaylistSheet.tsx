import { useState } from "react";
import { AlertCircle, Check, Link2, Loader2, X } from "lucide-react";
import type { ImportedEntry, PlaylistMatchItem } from "@sharetify/shared";
import { Sheet } from "./Sheet.js";
import { useLibrary } from "../lib/library-store.js";
import { nodeImportPlaylist, nodeMatchPlaylist } from "../lib/node-client.js";

interface Props {
  onClose: () => void;
  /** 取り込みが済んだら、その並びを開く。 */
  onDone: (playlistId: string) => void;
}

/** いまどこまで進んでいるか。 */
type Stage =
  | { name: "input" }
  | { name: "reading" }
  | { name: "preview"; title: string; entries: ImportedEntry[] }
  | { name: "matching"; title: string; total: number }
  | { name: "done"; items: PlaylistMatchItem[]; missed: number };

/**
 * よそで作った並びを持ってくる。
 *
 * 読み取りと突き合わせを分けて見せる。読み取りはすぐ終わるので、
 * まず何が入っていたかを出す。そこから先は曲数ぶん探しに行くので、
 * 待たせるぶんは持ち主が中身を見て決めてからにする。
 */
export function ImportPlaylistSheet({ onClose, onDone }: Props) {
  const { createPlaylist, addTrack } = useLibrary();
  const [source, setSource] = useState("");
  const [stage, setStage] = useState<Stage>({ name: "input" });
  const [error, setError] = useState<string | null>(null);

  const busy = stage.name === "reading" || stage.name === "matching";

  const read = async () => {
    const value = source.trim();
    if (!value) return;

    setError(null);
    setStage({ name: "reading" });

    try {
      /*
       * 一行だけで、頭が http なら住所として渡す。
       * そうでなければ、画面から写した文字として渡す。
       */
      const looksLikeUrl = !value.includes("\n") && /^https?:\/\//i.test(value);
      const read = await nodeImportPlaylist(looksLikeUrl ? { url: value } : { text: value });
      setStage({ name: "preview", title: read.name, entries: read.entries });
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "読み取れませんでした。");
      setStage({ name: "input" });
    }
  };

  const bring = async () => {
    if (stage.name !== "preview") return;

    const { title, entries } = stage;
    setError(null);
    setStage({ name: "matching", title, total: entries.length });

    try {
      const matched = await nodeMatchPlaylist(entries);
      const found = matched.items.filter((item) => item.track);

      if (found.length === 0) {
        setError("手元で見つかる曲がありませんでした。");
        setStage({ name: "preview", title, entries });
        return;
      }

      const playlist = await createPlaylist({ name: title });
      if (!playlist) {
        setError("プレイリストを作れませんでした。");
        setStage({ name: "preview", title, entries });
        return;
      }

      /*
       * 一曲ずつ順に入れる。
       *
       * まとめて投げると、入れる先の並びが後勝ちで上書きし合って
       * 数曲だけ残ることがある。数十曲なら順に入れても待てる。
       */
      for (const item of found) {
        if (item.track) await addTrack(playlist.id, item.track);
      }

      setStage({ name: "done", items: matched.items, missed: matched.missed });
      // 取りこぼしが無いなら、見せるものが無いのでそのまま開く。
      if (matched.missed === 0) onDone(playlist.id);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "取り込めませんでした。");
      setStage({ name: "preview", title, entries });
    }
  };

  return (
    <Sheet onClose={busy ? () => undefined : onClose} dismissible={!busy} className="max-h-[80vh] max-w-lg">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="text-lg font-bold">プレイリストを取り込む</h2>
          <p className="mt-1 text-xs text-ink-muted">
            Spotify と Apple Music はアドレスを貼るだけ。ほかは曲名を貼り付けてください。
          </p>
        </div>
        <button
          type="button"
          onClick={busy ? undefined : onClose}
          disabled={busy}
          className="shrink-0 text-ink-muted transition hover:text-ink disabled:opacity-40"
          aria-label="閉じる"
        >
          <X className="size-5" />
        </button>
      </div>

      {error && (
        <p className="mt-4 flex items-start gap-2 rounded-md bg-surface-3 p-3 text-xs text-ink-muted">
          <AlertCircle className="mt-0.5 size-4 shrink-0" />
          <span>{error}</span>
        </p>
      )}

      {(stage.name === "input" || stage.name === "reading") && (
        <div className="mt-4">
          <textarea
            value={source}
            onChange={(event) => setSource(event.target.value)}
            disabled={stage.name === "reading"}
            rows={5}
            autoFocus
            placeholder={
              "https://open.spotify.com/playlist/...\n\nまたは\n\n曲名 - アーティスト\n曲名 - アーティスト"
            }
            className="w-full resize-none rounded-md bg-surface-3 px-3 py-2 text-sm outline-none placeholder:text-ink-faint focus:ring-2 focus:ring-accent/40 disabled:opacity-50"
          />
          <button
            type="button"
            onClick={() => void read()}
            disabled={!source.trim() || stage.name === "reading"}
            className="mt-3 flex w-full items-center justify-center gap-2 rounded-full bg-accent px-4 py-2.5 text-sm font-semibold text-accent-ink transition hover:brightness-110 disabled:opacity-40"
          >
            {stage.name === "reading" ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                読み取っています…
              </>
            ) : (
              <>
                <Link2 className="size-4" />
                読み取る
              </>
            )}
          </button>
        </div>
      )}

      {stage.name === "preview" && (
        <div className="mt-4 flex min-h-0 flex-col">
          <p className="text-sm font-semibold">{stage.title}</p>
          <p className="mt-0.5 text-xs text-ink-muted">{stage.entries.length} 曲が見つかりました</p>

          <ul className="no-scrollbar mt-3 max-h-56 min-h-0 overflow-y-auto rounded-md bg-surface-3 p-2">
            {stage.entries.map((entry, index) => (
              <li key={`${entry.title}-${index}`} className="truncate px-2 py-1 text-xs">
                <span className="text-ink">{entry.title}</span>
                {entry.artist && <span className="text-ink-muted"> — {entry.artist}</span>}
              </li>
            ))}
          </ul>

          <p className="mt-3 text-xs text-ink-faint">
            ここから手元の音源を一曲ずつ探します。曲数によっては少し待ちます。
          </p>

          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={() => setStage({ name: "input" })}
              className="rounded-full px-4 py-2.5 text-sm font-semibold text-ink-muted transition hover:text-ink"
            >
              戻る
            </button>
            <button
              type="button"
              onClick={() => void bring()}
              className="flex flex-1 items-center justify-center gap-2 rounded-full bg-accent px-4 py-2.5 text-sm font-semibold text-accent-ink transition hover:brightness-110"
            >
              取り込む
            </button>
          </div>
        </div>
      )}

      {stage.name === "matching" && (
        <div className="mt-6 flex flex-col items-center gap-3 py-8">
          <Loader2 className="size-6 animate-spin text-ink-muted" />
          <p className="text-sm">{stage.title}</p>
          <p className="text-xs text-ink-muted">{stage.total} 曲を手元で探しています…</p>
        </div>
      )}

      {stage.name === "done" && (
        <div className="mt-4 flex min-h-0 flex-col">
          <p className="flex items-center gap-2 text-sm font-semibold">
            <Check className="size-4 text-accent" />
            {stage.items.length - stage.missed} 曲を取り込みました
          </p>

          {stage.missed > 0 && (
            <>
              <p className="mt-3 text-xs text-ink-muted">
                次の {stage.missed} 曲は手元で見つかりませんでした。
              </p>
              <ul className="no-scrollbar mt-2 max-h-48 min-h-0 overflow-y-auto rounded-md bg-surface-3 p-2">
                {stage.items
                  .filter((item) => !item.track)
                  .map((item, index) => (
                    <li key={`${item.entry.title}-${index}`} className="truncate px-2 py-1 text-xs">
                      <span className="text-ink">{item.entry.title}</span>
                      {item.entry.artist && (
                        <span className="text-ink-muted"> — {item.entry.artist}</span>
                      )}
                    </li>
                  ))}
              </ul>
            </>
          )}

          <button
            type="button"
            onClick={onClose}
            className="mt-4 w-full rounded-full bg-accent px-4 py-2.5 text-sm font-semibold text-accent-ink transition hover:brightness-110"
          >
            閉じる
          </button>
        </div>
      )}
    </Sheet>
  );
}
