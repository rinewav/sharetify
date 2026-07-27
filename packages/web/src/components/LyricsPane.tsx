import { useEffect, useMemo, useRef, useState } from "react";
import { ExternalLink, Loader2 } from "lucide-react";
import type { LyricsResult, Track } from "@musicshare/shared";
import { nodeLyrics } from "../lib/node-client.js";
import { usePlayer } from "../lib/player-store.js";

interface Props {
  track: Track;
  /** 中央に寄せて大きく出すか、脇に小さく添えるか。 */
  compact?: boolean;
}

/**
 * 歌詞。
 *
 * 時刻付きが手に入ったときは、いま鳴っている行を目立たせて送る。
 * 探すのは自分の PC 側で、見つからなければ探し先だけ示す。
 */
export function LyricsPane({ track, compact = false }: Props) {
  const [result, setResult] = useState<LyricsResult | null>(null);
  const [failed, setFailed] = useState(false);
  const positionMs = usePlayer((s) => s.positionMs);
  const seek = usePlayer((s) => s.seek);
  const containerRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef<HTMLParagraphElement>(null);
  /** 手で動かしている間は追いかけない。読んでいる場所を奪わないため。 */
  const [userScrolling, setUserScrolling] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    setResult(null);
    setFailed(false);

    nodeLyrics(track, controller.signal)
      .then((found) => {
        if (!controller.signal.aborted) setResult(found);
      })
      .catch(() => {
        if (!controller.signal.aborted) setFailed(true);
      });

    return () => controller.abort();
  }, [track.id]);

  /** いま鳴っている行。位置を過ぎた最後の行を選ぶ。 */
  const activeIndex = useMemo(() => {
    if (result?.kind !== "synced") return -1;
    const lines = result.lines;
    let index = -1;
    for (let i = 0; i < lines.length; i += 1) {
      if (lines[i]!.timeMs <= positionMs) index = i;
      else break;
    }
    return index;
  }, [result, positionMs]);

  // 進むたびに、いまの行を真ん中へ寄せる。
  useEffect(() => {
    if (userScrolling || activeIndex < 0) return;
    activeRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [activeIndex, userScrolling]);

  // 曲が変わったら追従を戻す。
  useEffect(() => setUserScrolling(false), [track.id]);

  if (failed || result?.kind === "none") {
    const searchUrl = result?.kind === "none" ? result.searchUrl : undefined;
    return (
      <Placeholder>
        <p>歌詞が見つかりませんでした。</p>
        {searchUrl && (
          <a
            href={searchUrl}
            target="_blank"
            rel="noreferrer noopener"
            className="mt-3 inline-flex items-center gap-1.5 text-xs text-ink-muted underline transition hover:text-ink"
          >
            <ExternalLink className="size-3.5" />
            外部で探す
          </a>
        )}
      </Placeholder>
    );
  }

  if (!result) {
    return (
      <Placeholder>
        <Loader2 className="size-4 animate-spin" />
      </Placeholder>
    );
  }

  if (result.kind === "instrumental") {
    return <Placeholder>この曲には歌詞がありません。</Placeholder>;
  }

  if (result.kind === "plain") {
    return (
      <div
        ref={containerRef}
        className={`scroll-area h-full whitespace-pre-line ${
          compact ? "text-sm" : "text-base sm:text-lg"
        } leading-loose text-ink-muted`}
      >
        {result.text}
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      onWheel={() => setUserScrolling(true)}
      onTouchMove={() => setUserScrolling(true)}
      className="scroll-area h-full"
    >
      <div className={compact ? "py-4" : "py-[35%]"}>
        {result.lines.map((line, index) => {
          const active = index === activeIndex;
          return (
            <p
              key={`${line.timeMs}-${index}`}
              ref={active ? activeRef : undefined}
              onClick={() => seek(line.timeMs)}
              className={`cursor-pointer px-2 py-1.5 leading-snug transition-all duration-300 ${
                compact ? "text-sm" : "text-xl sm:text-3xl"
              } ${
                active
                  ? "font-bold text-ink"
                  : index < activeIndex
                    ? "text-ink-faint"
                    : "text-ink-muted"
              }`}
            >
              {line.text || "♪"}
            </p>
          );
        })}
      </div>

      {userScrolling && (
        <button
          type="button"
          onClick={() => setUserScrolling(false)}
          className="sticky bottom-2 left-1/2 -translate-x-1/2 rounded-full bg-surface-3 px-4 py-2 text-xs text-ink-muted shadow-lg transition hover:text-ink"
        >
          再生位置に戻る
        </button>
      )}
    </div>
  );
}

function Placeholder({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center text-sm text-ink-faint">
      {children}
    </div>
  );
}
