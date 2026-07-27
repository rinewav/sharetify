import { useEffect, useState } from "react";
import { Laptop, Loader2, WifiOff } from "lucide-react";
import type { NodeHealth } from "@sharetify/shared";
import { nodeHealth } from "../lib/node-client.js";
import { isDesktopApp } from "../lib/platform.js";

interface Props {
  health: NodeHealth | null;
  onClick: () => void;
}

/**
 * 自分の PC との繋がり具合。
 *
 * 繋がっているかどうかだけでなく、どれくらい速いかも出す。
 * 色は状態そのものを表す。繋がっていないのに色が付いていると、
 * 繋がっているように見えてしまう。
 *
 * 配って回す入れ物の中では、自分がその PC なので言い方を変える。
 * 「つなぐ先」ではなく「ここで動いている」。
 */
export function ConnectionIndicator({ health, onClick }: Props) {
  const desktop = isDesktopApp();
  const online = health?.ok === true;
  const latency = useLatency(online);

  const level = online ? levelOf(latency) : 0;
  const label = desktop
    ? online
      ? "この PC"
      : "起動待ち"
    : online
      ? "自分の PC"
      : "つなぐ";

  return (
    <button
      type="button"
      onClick={onClick}
      className={`app-no-drag flex items-center gap-1.5 rounded-full bg-base/60 px-3 py-1.5 text-xs transition ${
        online ? "text-ink-muted hover:text-ink" : "text-ink-faint hover:text-ink-muted"
      }`}
      title={describe(desktop, online, latency)}
    >
      {online ? (
        desktop ? (
          <Laptop className="size-3.5 text-accent" />
        ) : (
          <Bars level={level} />
        )
      ) : latency === "measuring" ? (
        <Loader2 className="size-3.5 animate-spin" />
      ) : (
        <WifiOff className="size-3.5" />
      )}
      <span className="hidden sm:inline">{label}</span>
    </button>
  );
}

/**
 * 電波の強さ。
 *
 * 3 本のうち、届いている分だけを明るくする。
 * 繋がっていないときは全部沈めるので、色で取り違えることがない。
 */
function Bars({ level }: { level: number }) {
  const heights = ["h-1.5", "h-2.5", "h-3.5"];
  return (
    <span className="flex items-end gap-[2px]" aria-hidden>
      {heights.map((h, i) => (
        <span
          key={h}
          className={`w-[3px] rounded-sm transition-colors ${h} ${
            i < level ? colorFor(level) : "bg-ink-faint/30"
          }`}
        />
      ))}
    </span>
  );
}

/** 速いほど落ち着いた色。遅いときは目に留まる色にする。 */
function colorFor(level: number): string {
  if (level >= 3) return "bg-accent";
  if (level === 2) return "bg-amber-400";
  return "bg-red-400";
}

type Latency = number | "measuring" | "unknown";

function levelOf(latency: Latency): number {
  if (typeof latency !== "number") return 2;
  if (latency < 80) return 3;
  if (latency < 300) return 2;
  return 1;
}

function describe(desktop: boolean, online: boolean, latency: Latency): string {
  if (!online) {
    return desktop
      ? "この PC の中の仕組みがまだ動いていません"
      : "自分の PC に接続できていません。押してつなぐ";
  }
  const speed = typeof latency === "number" ? `応答 ${latency} ms` : "応答を測っています";
  return desktop ? `この PC で動いています（${speed}）` : `自分の PC につながっています（${speed}）`;
}

/**
 * どれくらいで返ってくるかを測る。
 *
 * 繋がっているかだけでは、遅くて使いものにならない状態が見えない。
 * 何度か測って一番良い値を採る。たまたま詰まった一回に引きずられないため。
 */
function useLatency(online: boolean): Latency {
  const [latency, setLatency] = useState<Latency>("measuring");

  useEffect(() => {
    if (!online) {
      setLatency("unknown");
      return;
    }

    let cancelled = false;

    const measure = async () => {
      const samples: number[] = [];
      for (let i = 0; i < 3; i += 1) {
        const started = performance.now();
        try {
          await nodeHealth();
          samples.push(performance.now() - started);
        } catch {
          if (!cancelled) setLatency("unknown");
          return;
        }
      }
      if (!cancelled && samples.length > 0) {
        setLatency(Math.round(Math.min(...samples)));
      }
    };

    void measure();
    // 途中で悪くなることもある。ときどき測り直す。
    const timer = setInterval(measure, 20_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [online]);

  return latency;
}
