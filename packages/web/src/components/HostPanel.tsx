import { useEffect, useState } from "react";
import { Check, Copy, Laptop, Loader2, Smartphone, X } from "lucide-react";
import { PairQr } from "./PairQr.js";
import { Sheet } from "./Sheet.js";
import { nodePairingStatus, type PairingStatus } from "../lib/node-client.js";

interface Props {
  onClose: () => void;
}

/**
 * この PC が迎える側であることを示す画面。
 *
 * 配って回す入れ物の中では、自分の PC は「つなぐ先」ではなく「つながれる側」。
 * どこにも出していないと、スマホから何をすればいいのか分からない。
 * 渡す合言葉と、いま繋がっている数をここで見せる。
 */
export function HostPanel({ onClose }: Props) {
  const status = usePairingStatus();
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    if (!status?.code) return;
    try {
      await navigator.clipboard.writeText(status.code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // 書き込めない環境では、見せるだけで足りる。
    }
  };

  return (
    <Sheet onClose={onClose} className="max-w-sm">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="text-lg font-bold">この PC で動いています</h2>
          <p className="mt-1 text-xs text-ink-muted">
            曲を探して取ってくるのはこの PC。スマホからはここへつなぎます。
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

      {/* 動いていることが一目で分かるようにする。 */}
      <div className="mt-5 flex items-center gap-3 rounded-lg bg-surface-2 p-3">
        <span className="relative grid size-10 shrink-0 place-items-center rounded-full bg-accent/15 text-accent">
          <Laptop className="size-5" />
          <span className="absolute -right-0.5 -bottom-0.5 size-3 rounded-full border-2 border-surface-2 bg-accent" />
        </span>
        <div className="min-w-0">
          <div className="text-sm font-medium">動作中</div>
          <div className="text-xs text-ink-muted">
            {status === null
              ? "確かめています…"
              : status.enabled
                ? "外からつないでもらえます"
                : "この PC の中だけで使えます"}
          </div>
        </div>
      </div>

      {/* 向けてもらうだけで繋がる。読み上げて打ってもらうより早い。 */}
      {status?.code && (
        <div className="mt-4 flex justify-center">
          <PairQr code={status.code} />
        </div>
      )}

      <div className="mt-4">
        <div className="text-xs font-semibold text-ink-faint">読み取れないときは合言葉で</div>
        {status?.code ? (
          <button
            type="button"
            onClick={() => void copy()}
            className="press mt-2 flex w-full items-center justify-between gap-3 rounded-lg bg-surface-3 px-4 py-3 transition hover:brightness-110"
            title="押すと写します"
          >
            <span className="font-mono text-2xl tracking-[0.3em]">{status.code}</span>
            <span className="flex shrink-0 items-center gap-1.5 text-xs text-ink-muted">
              {copied ? (
                <>
                  <Check className="size-3.5 text-accent" />
                  写しました
                </>
              ) : (
                <>
                  <Copy className="size-3.5" />
                  写す
                </>
              )}
            </span>
          </button>
        ) : (
          <div className="mt-2 flex items-center gap-2 rounded-lg bg-surface-3 px-4 py-3 text-sm text-ink-muted">
            <Loader2 className="size-4 animate-spin" />
            用意しています…
          </div>
        )}
        <p className="mt-2 text-[11px] leading-relaxed text-ink-faint">
          スマホのカメラを上の絵に向けるか、
          <span className="text-ink-muted"> sharetify.rine.bio </span>
          を開いて右上の「つなぐ」からこの合言葉を入れてください。
        </p>
      </div>

      {/* 何台つながっているか。無言だと届いているのか分からない。 */}
      <div className="mt-4 flex items-center gap-3 rounded-lg bg-surface-2 p-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-full bg-surface-3 text-ink-muted">
          <Smartphone className="size-5" />
        </span>
        <div className="min-w-0">
          <div className="text-sm font-medium">
            {status?.guests ? `${status.guests} 台つながっています` : "まだつながっていません"}
          </div>
          <div className="text-xs text-ink-muted">
            つないだ端末とは直接やり取りします
          </div>
        </div>
      </div>

      <p className="mt-4 text-[11px] leading-relaxed text-ink-faint">
        この窓を閉じても動き続けます。閉じると、外出先のスマホからは
        端末に残した曲しか鳴らせなくなります。
      </p>
    </Sheet>
  );
}

/** 迎える側の状態を、少しずつ見に行く。 */
function usePairingStatus(): PairingStatus | null {
  const [status, setStatus] = useState<PairingStatus | null>(null);

  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      try {
        const next = await nodePairingStatus();
        if (!cancelled) setStatus(next);
      } catch {
        if (!cancelled) setStatus({ code: null, guests: 0, enabled: false });
      }
    };
    void check();
    // 合言葉は期限で入れ替わるし、つながる数も変わる。
    const timer = setInterval(check, 5_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  return status;
}
