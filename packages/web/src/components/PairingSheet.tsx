import { useEffect, useRef, useState } from "react";
import { Check, Laptop, Loader2, X } from "lucide-react";
import { PAIR_CODE_LENGTH } from "@sharetify/shared";
import { Sheet } from "./Sheet.js";
import { peerClient, type PeerStatus } from "../lib/peer-client.js";

const STORED_CODE_KEY = "sharetify.pair-code";

interface Props {
  onClose: () => void;
}

/**
 * 合言葉を入れて自分の PC につなぐ画面。
 *
 * 利用者にしてもらうのはここでの入力だけ。
 * 同じネットワークに入る設定や、機器ごとの住所の確認は要らない。
 */
export function PairingSheet({ onClose }: Props) {
  const [code, setCode] = useState(() => localStorage.getItem(STORED_CODE_KEY) ?? "");
  const [status, setStatus] = useState<PeerStatus>(peerClient.currentStatus);
  const [detail, setDetail] = useState<string>();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => peerClient.onStatus((next, reason) => {
    setStatus(next);
    setDetail(reason);
  }), []);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const submit = () => {
    const value = code.trim().toUpperCase();
    if (value.length !== PAIR_CODE_LENGTH) return;
    // つながった実績のある合言葉は覚えておき、次回は自動でつなぐ。
    localStorage.setItem(STORED_CODE_KEY, value);
    peerClient.connect(value);
  };

  const connected = status === "connected";

  return (
    <Sheet onClose={onClose} className="max-w-sm">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-bold">自分の PC につなぐ</h2>
            <p className="mt-1 text-xs text-ink-muted">
              PC 側のアプリに出ている合言葉を入力してください。
            </p>
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

        <div className="mt-5">
          <input
            ref={inputRef}
            value={code}
            onChange={(event) => setCode(event.target.value.toUpperCase().slice(0, PAIR_CODE_LENGTH))}
            onKeyDown={(event) => event.key === "Enter" && submit()}
            placeholder="ABC123"
            inputMode="text"
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            className="w-full rounded-lg bg-surface-3 py-4 text-center font-mono text-2xl tracking-[0.4em] outline-none placeholder:text-ink-faint focus:ring-2 focus:ring-accent/40"
          />
        </div>

        <StatusLine status={status} detail={detail} />

        <button
          type="button"
          onClick={connected ? onClose : submit}
          disabled={!connected && code.trim().length !== PAIR_CODE_LENGTH}
          className="mt-4 w-full rounded-full bg-accent py-3 text-sm font-semibold text-accent-ink transition hover:brightness-110 disabled:opacity-40"
        >
          {connected ? "閉じる" : "つなぐ"}
        </button>

        <p className="mt-4 text-[11px] leading-relaxed text-ink-faint">
          PC 側に出ている絵をカメラで読み取れば、打たずに繋げます。
        </p>
        <p className="mt-2 text-[11px] leading-relaxed text-ink-faint">
          つないだあとは、この端末と PC が直接やり取りします。
          曲のデータが運営側のサーバーを通ることはありません。
        </p>
    </Sheet>
  );
}

function StatusLine({ status, detail }: { status: PeerStatus; detail?: string }) {
  if (status === "idle") return <div className="mt-4 h-5" />;

  const busy = status === "connecting" || status === "waiting-host";

  return (
    <div className="mt-4 flex h-5 items-center gap-2 text-xs">
      {busy && <Loader2 className="size-3.5 animate-spin text-ink-muted" />}
      {status === "connected" && <Check className="size-3.5 text-accent" />}
      {status === "failed" && <Laptop className="size-3.5 text-amber-400" />}
      <span
        className={
          status === "connected"
            ? "text-accent"
            : status === "failed"
              ? "text-amber-300"
              : "text-ink-muted"
        }
      >
        {label(status, detail)}
      </span>
    </div>
  );
}

function label(status: PeerStatus, detail?: string): string {
  switch (status) {
    case "connecting":
      return "呼び出しています…";
    case "waiting-host":
      return "PC を探しています…";
    case "connected":
      return "つながりました";
    case "failed":
      return detail ?? "つながりませんでした";
    case "closed":
      return detail ?? "接続が切れました";
    default:
      return "";
  }
}

/** 前回つないだ合言葉があれば、起動時に黙って繋ぎ直す。 */
export function useAutoPairing(): PeerStatus {
  const [status, setStatus] = useState<PeerStatus>(peerClient.currentStatus);

  useEffect(() => peerClient.onStatus(setStatus), []);

  useEffect(() => {
    /*
     * 絵を読み取って開いたときは、そこに合言葉が入っている。
     * 打ち直してもらう必要はないので、そのまま繋ぐ。
     */
    const fromLink = new URLSearchParams(window.location.search).get("pair");
    const code = fromLink?.trim().toUpperCase() || localStorage.getItem(STORED_CODE_KEY);
    if (!code) return;

    if (fromLink) {
      localStorage.setItem(STORED_CODE_KEY, code);
      // 住所に残しておくと、次に開いたときも同じ合言葉で繋ごうとする。
      const clean = new URL(window.location.href);
      clean.searchParams.delete("pair");
      window.history.replaceState(null, "", clean.toString());
    }

    peerClient.connect(code);
  }, []);

  return status;
}
