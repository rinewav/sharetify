import { useState } from "react";
import { Loader2, X } from "lucide-react";
import { useLibrary } from "../lib/library-store.js";

interface Props {
  onClose: () => void;
  /** 閉じられない場面 (まだ誰でもない状態) では見送りを出さない。 */
  dismissible?: boolean;
}

/**
 * 名前を決めるだけの入り口。
 *
 * 合言葉も住所も要らない。ここで作られるのは、友だちと共有するときに
 * 誰の作った並びなのかを示すための名前だけ。
 */
export function SignInSheet({ onClose, dismissible = true }: Props) {
  const { signIn, loading, error } = useLibrary();
  const [name, setName] = useState("");

  const submit = async () => {
    const value = name.trim();
    if (!value) return;
    await signIn(value);
    if (!useLibrary.getState().error) onClose();
  };

  return (
    <div className="animate-fade fixed inset-0 z-30 flex items-end justify-center bg-black/70 p-3 sm:items-center">
      <div className="animate-slide-up w-full max-w-sm rounded-2xl bg-surface p-5 shadow-2xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-bold">名前を決める</h2>
            <p className="mt-1 text-xs text-ink-muted">
              友だちと共有するときに表示されます。あとから変えられます。
            </p>
          </div>
          {dismissible && (
            <button
              type="button"
              onClick={onClose}
              className="shrink-0 text-ink-muted transition hover:text-ink"
              aria-label="閉じる"
            >
              <X className="size-5" />
            </button>
          )}
        </div>

        <input
          value={name}
          onChange={(event) => setName(event.target.value.slice(0, 24))}
          onKeyDown={(event) => event.key === "Enter" && void submit()}
          placeholder="りね"
          autoCapitalize="off"
          className="mt-5 w-full rounded-lg bg-surface-3 px-4 py-3 text-base outline-none placeholder:text-ink-faint focus:ring-2 focus:ring-accent/40"
        />

        {error && <p className="mt-3 text-xs text-amber-300">{error}</p>}

        <button
          type="button"
          onClick={() => void submit()}
          disabled={loading || name.trim().length === 0}
          className="mt-4 flex w-full items-center justify-center gap-2 rounded-full bg-accent py-3 text-sm font-semibold text-accent-ink transition hover:brightness-110 disabled:opacity-40"
        >
          {loading && <Loader2 className="size-4 animate-spin" />}
          はじめる
        </button>
      </div>
    </div>
  );
}
