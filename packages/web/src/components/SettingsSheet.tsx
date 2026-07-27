import { useEffect, useState } from "react";
import { Check, ExternalLink, Loader2, Trash2, X } from "lucide-react";
import { Sheet } from "./Sheet.js";
import { useLibrary } from "../lib/library-store.js";
import {
  lastfmBegin,
  lastfmComplete,
  lastfmDisconnect,
  lastfmSetKeys,
  lastfmStatus,
  type LastfmStatus,
} from "../lib/node-client.js";
import { cacheUsage, clearCache, formatBytes } from "../lib/offline-cache.js";
import { setScrobblingEnabled } from "../lib/scrobbler.js";

interface Props {
  onClose: () => void;
  onOpenPairing: () => void;
  nodeOnline: boolean;
}

export function SettingsSheet({ onClose, onOpenPairing, nodeOnline }: Props) {
  const { user, signOut } = useLibrary();

  return (
    <Sheet onClose={onClose} className="max-h-[85vh] max-w-md">
        <div className="flex items-start justify-between gap-4">
          <h2 className="text-lg font-bold">設定</h2>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 text-ink-muted transition hover:text-ink"
            aria-label="閉じる"
          >
            <X className="size-5" />
          </button>
        </div>

        <div className="scroll-area mt-4 min-h-0 flex-1 space-y-6 pr-1">
          <NameSection />
          <Section title="自分の PC">
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs text-ink-muted">
                {nodeOnline
                  ? "つながっています。検索と再生ができます。"
                  : "つながっていません。手元に残した曲だけ再生できます。"}
              </p>
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onOpenPairing();
                }}
                className="shrink-0 rounded-full bg-surface-3 px-4 py-2 text-xs font-medium transition hover:bg-line"
              >
                {nodeOnline ? "つなぎ直す" : "つなぐ"}
              </button>
            </div>
          </Section>

          <OfflineSection />
          <LastfmSection nodeOnline={nodeOnline} />

          {user && (
            <Section title="サインイン">
              <button
                type="button"
                onClick={() => {
                  signOut();
                  onClose();
                }}
                className="w-full rounded-full border border-line py-2.5 text-xs text-ink-muted transition hover:border-ink-muted hover:text-ink"
              >
                サインアウト
              </button>
            </Section>
          )}
        </div>
    </Sheet>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="mb-2 text-xs font-semibold text-ink-faint">{title}</h3>
      {children}
    </section>
  );
}

function NameSection() {
  const { user } = useLibrary();
  return (
    <Section title="名前">
      <p className="text-sm">{user?.displayName ?? "未設定"}</p>
      <p className="mt-1 text-xs text-ink-faint">共有したときに相手から見える名前です。</p>
    </Section>
  );
}

function OfflineSection() {
  const [usage, setUsage] = useState<{ bytes: number; count: number } | null>(null);
  const [clearing, setClearing] = useState(false);

  const load = () => void cacheUsage().then(setUsage);
  useEffect(load, []);

  return (
    <Section title="この端末に残した曲">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-ink-muted">
          {usage
            ? usage.count === 0
              ? "まだありません。再生した曲がここに残ります。"
              : `${usage.count} 曲 · ${formatBytes(usage.bytes)}`
            : "確認中…"}
        </p>
        {usage && usage.count > 0 && (
          <button
            type="button"
            onClick={async () => {
              setClearing(true);
              await clearCache();
              load();
              setClearing(false);
            }}
            disabled={clearing}
            className="flex shrink-0 items-center gap-1.5 rounded-full bg-surface-3 px-3 py-2 text-xs transition hover:bg-line disabled:opacity-40"
          >
            <Trash2 className="size-3.5" />
            すべて消す
          </button>
        )}
      </div>
      <p className="mt-2 text-[11px] leading-relaxed text-ink-faint">
        PC が落ちている間は、ここに残っている曲だけ再生できます。
      </p>
    </Section>
  );
}

/**
 * 聴取記録の連携。
 *
 * 鍵は各自で用意してもらう。手元の PC の中にだけ置かれ、
 * 運営側のサーバーには渡らない。
 */
function LastfmSection({ nodeOnline }: { nodeOnline: boolean }) {
  const [status, setStatus] = useState<LastfmStatus | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [apiSecret, setApiSecret] = useState("");
  const [pendingToken, setPendingToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    if (!nodeOnline) return;
    void lastfmStatus()
      .then((next) => {
        setStatus(next);
        setScrobblingEnabled(next.connected);
      })
      .catch(() => setStatus(null));
  };
  useEffect(load, [nodeOnline]);

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "うまくいきませんでした。");
    } finally {
      setBusy(false);
    }
  };

  if (!nodeOnline) {
    return (
      <Section title="聴取記録">
        <p className="text-xs text-ink-faint">自分の PC につながると設定できます。</p>
      </Section>
    );
  }

  return (
    <Section title="聴取記録 (last.fm)">
      {status?.connected ? (
        <div className="flex items-center justify-between gap-3">
          <p className="flex items-center gap-1.5 text-sm">
            <Check className="size-4 text-accent" />
            {status.username}
          </p>
          <button
            type="button"
            onClick={() => void run(async () => setStatus(await lastfmDisconnect()))}
            disabled={busy}
            className="shrink-0 rounded-full bg-surface-3 px-3 py-2 text-xs transition hover:bg-line disabled:opacity-40"
          >
            解除
          </button>
        </div>
      ) : status?.configured ? (
        <div className="space-y-2">
          {pendingToken ? (
            <>
              <p className="text-xs text-ink-muted">
                開いた画面で許可したら、下を押してください。
              </p>
              <button
                type="button"
                onClick={() =>
                  void run(async () => {
                    await lastfmComplete(pendingToken);
                    setPendingToken(null);
                    load();
                  })
                }
                disabled={busy}
                className="flex w-full items-center justify-center gap-2 rounded-full bg-accent py-2.5 text-xs font-semibold text-accent-ink disabled:opacity-40"
              >
                {busy && <Loader2 className="size-3.5 animate-spin" />}
                許可したので続ける
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() =>
                void run(async () => {
                  const { token, authUrl } = await lastfmBegin();
                  setPendingToken(token);
                  window.open(authUrl, "_blank", "noopener");
                })
              }
              disabled={busy}
              className="flex w-full items-center justify-center gap-2 rounded-full bg-accent py-2.5 text-xs font-semibold text-accent-ink disabled:opacity-40"
            >
              {busy ? <Loader2 className="size-3.5 animate-spin" /> : <ExternalLink className="size-3.5" />}
              連携する
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          <p className="text-[11px] leading-relaxed text-ink-faint">
            last.fm で API アカウントを作ると鍵が発行されます。入力した鍵は
            自分の PC の中にだけ保存され、運営側には渡りません。
          </p>
          <input
            value={apiKey}
            onChange={(event) => setApiKey(event.target.value)}
            placeholder="API key"
            autoCapitalize="off"
            autoCorrect="off"
            className="w-full rounded-lg bg-surface-3 px-3 py-2 font-mono text-xs outline-none placeholder:text-ink-faint focus:ring-2 focus:ring-accent/40"
          />
          <input
            value={apiSecret}
            onChange={(event) => setApiSecret(event.target.value)}
            placeholder="Shared secret"
            type="password"
            autoCapitalize="off"
            autoCorrect="off"
            className="w-full rounded-lg bg-surface-3 px-3 py-2 font-mono text-xs outline-none placeholder:text-ink-faint focus:ring-2 focus:ring-accent/40"
          />
          <button
            type="button"
            onClick={() =>
              void run(async () => {
                setStatus(await lastfmSetKeys(apiKey.trim(), apiSecret.trim()));
                setApiKey("");
                setApiSecret("");
              })
            }
            disabled={busy || !apiKey.trim() || !apiSecret.trim()}
            className="w-full rounded-full bg-surface-3 py-2.5 text-xs font-medium transition hover:bg-line disabled:opacity-40"
          >
            保存
          </button>
        </div>
      )}

      {error && <p className="mt-2 text-xs text-amber-300">{error}</p>}
    </Section>
  );
}
