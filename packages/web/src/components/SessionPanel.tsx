import { Check, Crown, Loader2, Radio, X } from "lucide-react";
import { useSession } from "../lib/session-store.js";
import { usePlayer } from "../lib/player-store.js";

interface Props {
  onClose: () => void;
  /** 狭い画面で覆いかぶせるときは幅を固定しない。 */
  fullWidth?: boolean;
}

/**
 * 一緒に聴くパネル。
 *
 * この方式では音を配らず再生位置だけを揃えるので、
 * 参加者ごとに「その曲を用意できたか」が変わりうる。
 * 誰が引っかかっているのかをここで可視化しておかないと、
 * 一人だけ無音になったときに原因が分からない。
 */
export function SessionPanel({ onClose, fullWidth = false }: Props) {
  const { participants, connected, driftMs, roundTripMs, leaveSession } = useSession();
  const track = usePlayer((s) => s.current());
  const waiting = participants.filter((p) => !p.ready);

  return (
    <aside
      className={`flex h-full shrink-0 flex-col rounded-lg bg-surface ${
        fullWidth ? "w-full" : "w-[320px]"
      }`}
    >
      <header className="flex items-center justify-between px-4 py-3">
        <div className="flex items-center gap-2">
          <Radio className={`size-4 ${connected ? "text-accent" : "text-ink-faint"}`} />
          <span className="text-sm font-semibold">一緒に聴く</span>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="text-ink-muted transition hover:text-ink"
          aria-label="閉じる"
        >
          <X className="size-4" />
        </button>
      </header>

      {!connected ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
          <p className="text-sm text-ink-muted">
            グループを選ぶと、友だちと同じ位置で同時に再生できます。
          </p>
          <p className="text-xs text-ink-faint">
            音声は各自の PC から直接取得されます。曲データが誰かの回線を経由することはありません。
          </p>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="border-b border-line px-4 pb-3">
            <div className="text-xs text-ink-faint">再生中</div>
            <div className="truncate text-sm">{track?.title ?? "—"}</div>
          </div>

          <div className="scroll-area min-h-0 flex-1 px-2 py-2">
            {participants.map((participant) => (
              <div
                key={participant.userId}
                className="flex items-center gap-3 rounded-md px-2 py-2 hover:bg-surface-2"
              >
                <div className="grid size-8 shrink-0 place-items-center rounded-full bg-surface-3 text-xs font-semibold">
                  {participant.displayName.slice(0, 1)}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate text-sm">{participant.displayName}</span>
                    {participant.isHost && (
                      <Crown className="size-3 shrink-0 text-accent" aria-label="ホスト" />
                    )}
                  </div>
                  {!participant.ready && (
                    <div className="truncate text-xs text-ink-faint">
                      {participant.reason ?? "この曲を準備しています"}
                    </div>
                  )}
                </div>
                {participant.ready ? (
                  <Check className="size-4 shrink-0 text-accent" />
                ) : (
                  <Loader2 className="size-4 shrink-0 animate-spin text-ink-faint" />
                )}
              </div>
            ))}
          </div>

          <div className="border-t border-line px-4 py-3">
            <div className="flex justify-between text-xs text-ink-faint">
              <span>ずれ</span>
              <span className="tabular-nums">{Math.round(driftMs)} ms</span>
            </div>
            <div className="mt-1 flex justify-between text-xs text-ink-faint">
              <span>往復</span>
              <span className="tabular-nums">{Math.round(roundTripMs)} ms</span>
            </div>
            {waiting.length > 0 && (
              <div className="mt-2 text-xs text-ink-muted">
                {waiting.length} 人がまだ準備中
              </div>
            )}
            <button
              type="button"
              onClick={leaveSession}
              className="mt-3 w-full rounded-full border border-line py-2 text-xs font-medium text-ink-muted transition hover:border-ink-muted hover:text-ink"
            >
              セッションから抜ける
            </button>
          </div>
        </div>
      )}
    </aside>
  );
}
