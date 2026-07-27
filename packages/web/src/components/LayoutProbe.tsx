import { useEffect, useState } from "react";

/**
 * 画面の縁まわりを実測して表示する。
 *
 * 端末ごとの余白は手元の環境では再現しきれないので、
 * 推測で直すより実機の数値を見たほうが早い。
 * `?debug=layout` を付けたときだけ出る。
 */

interface Metrics {
  innerHeight: number;
  visualViewport: number;
  clientHeight: number;
  bodyHeight: number;
  bodyPaddingTop: string;
  bodyPaddingBottom: string;
  safeTop: string;
  safeBottom: string;
  /** 一番下の要素の下端から画面下端までの隙間。これが余白の正体。 */
  gapBelowNav: number | null;
  standalone: boolean;
}

function measure(): Metrics {
  const styles = getComputedStyle(document.body);
  const probe = document.createElement("div");
  probe.style.cssText =
    "position:fixed;top:0;left:0;height:env(safe-area-inset-bottom);width:env(safe-area-inset-top);visibility:hidden";
  document.body.appendChild(probe);
  const safeBottom = getComputedStyle(probe).height;
  const safeTop = getComputedStyle(probe).width;
  probe.remove();

  const nav = document.querySelector("nav.md\\:hidden") ?? document.querySelector("footer");
  const navRect = nav?.getBoundingClientRect();

  return {
    innerHeight: Math.round(window.innerHeight),
    visualViewport: Math.round(window.visualViewport?.height ?? 0),
    clientHeight: document.documentElement.clientHeight,
    bodyHeight: Math.round(document.body.getBoundingClientRect().height),
    bodyPaddingTop: styles.paddingTop,
    bodyPaddingBottom: styles.paddingBottom,
    safeTop,
    safeBottom,
    gapBelowNav: navRect ? Math.round(window.innerHeight - navRect.bottom) : null,
    standalone:
      window.matchMedia("(display-mode: standalone)").matches ||
      (navigator as { standalone?: boolean }).standalone === true,
  };
}

export function LayoutProbe() {
  const [metrics, setMetrics] = useState<Metrics | null>(null);

  useEffect(() => {
    const update = () => setMetrics(measure());
    update();
    window.addEventListener("resize", update);
    window.visualViewport?.addEventListener("resize", update);
    return () => {
      window.removeEventListener("resize", update);
      window.visualViewport?.removeEventListener("resize", update);
    };
  }, []);

  if (!metrics) return null;

  return (
    <div className="pointer-events-none fixed top-16 left-2 z-50 rounded-md bg-black/85 p-2 font-mono text-[10px] leading-tight text-lime-300">
      {Object.entries(metrics).map(([key, value]) => (
        <div key={key}>
          {key}: <span className="text-white">{String(value)}</span>
        </div>
      ))}
    </div>
  );
}

export function layoutProbeEnabled(): boolean {
  return new URLSearchParams(window.location.search).get("debug") === "layout";
}
