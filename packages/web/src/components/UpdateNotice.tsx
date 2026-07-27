import { useEffect, useState } from "react";
import { ArrowUpCircle, X } from "lucide-react";
import { isDesktopApp } from "../lib/platform.js";
import { dismissUpdate, watchForUpdate, type UpdateInfo } from "../lib/update-check.js";

/**
 * 新しい版が出ていることを知らせる帯。
 *
 * デスクトップアプリは自分では新しくならないので、ここで気づいてもらう。
 * 押せばダウンロードの場所が開く。閉じれば、その版については二度と出ない。
 * ブラウザで開いている場合は常に最新が配られるので、何も出さない。
 */
export function UpdateNotice({ version }: { version: string | null }) {
  const [update, setUpdate] = useState<UpdateInfo | null>(null);

  useEffect(() => {
    if (!isDesktopApp()) return;
    return watchForUpdate(() => version, setUpdate);
  }, [version]);

  if (!update) return null;

  return (
    <div className="animate-rise fixed right-4 bottom-24 z-40 flex items-center gap-3 rounded-lg border border-line bg-surface-2 py-3 pr-2 pl-4 shadow-xl shadow-black/40">
      <ArrowUpCircle className="size-5 shrink-0 text-accent" />
      <div className="min-w-0">
        <p className="text-sm font-semibold">新しいバージョンがあります</p>
        <p className="mt-0.5 text-xs text-ink-muted">
          v{update.version} が公開されています。
        </p>
      </div>
      <a
        href={update.url}
        target="_blank"
        rel="noreferrer"
        className="press shrink-0 rounded-full bg-accent px-4 py-2 text-xs font-semibold text-accent-ink transition hover:brightness-110"
      >
        入手する
      </a>
      <button
        type="button"
        aria-label="この版については通知しない"
        onClick={() => {
          dismissUpdate(update.version);
          setUpdate(null);
        }}
        className="shrink-0 p-1.5 text-ink-muted transition hover:text-ink"
      >
        <X className="size-4" />
      </button>
    </div>
  );
}
