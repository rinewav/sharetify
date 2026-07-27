import { useEffect, useState } from "react";

/**
 * 画面の縁まわりを実測して表示する。
 *
 * 端末ごとの余白は手元の環境では再現しきれないので、
 * 推測で直すより実機の数値を見たほうが早い。
 * `?debug=layout` を付けたときだけ出る。
 */

interface Metrics {
  /** 端末が持つ画面の高さ。ここが基準。 */
  screenHeight: number;
  innerHeight: number;
  systemInset: number;
  bodyTop: number;
  bodyBottom: number;
  bodyHeight: number;
  rootPaddingTop: string;
  bodyPaddingBottom: string;
  safeTop: string;
  safeBottom: string;
  navPaddingBottom: string;
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
  const bodyRect = document.body.getBoundingClientRect();

  /*
   * 基準は端末の画面そのものにする。
   * ブラウザが報告する表示領域は上端の帯を除いた値になることがあり、
   * それを基準に測ると隙間が見えていても 0 と出てしまう。
   */
  const screenHeight = window.screen.height;

  return {
    screenHeight,
    innerHeight: Math.round(window.innerHeight),
    /*
     * 端末側が既に確保している分。
     * ここが上端の帯と同じなら、こちらで上に余白を足すと二重になる。
     */
    systemInset: Math.round(screenHeight - window.innerHeight),
    bodyTop: Math.round(bodyRect.top),
    bodyBottom: Math.round(bodyRect.bottom),
    bodyHeight: Math.round(bodyRect.height),
    rootPaddingTop: getComputedStyle(
      document.getElementById("root")?.firstElementChild ?? document.body,
    ).paddingTop,
    bodyPaddingBottom: styles.paddingBottom,
    safeTop,
    safeBottom,
    navPaddingBottom: nav ? getComputedStyle(nav).paddingBottom : "-",
    /** 下部ナビの下端が表示領域の下端に達しているか。 */
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

    /*
     * 表示領域と下部ナビに枠を出す。
     * 数値だけでは、余っているのが描ける範囲の中なのか外なのか分からない。
     * 枠の外側に黒が残っていれば、それは端末側が塗っている領域。
     */
    const nav = document.querySelector("nav.md\\:hidden");
    document.body.classList.add("debug-bounds-body");
    nav?.classList.add("debug-bounds-nav");

    window.addEventListener("resize", update);
    window.visualViewport?.addEventListener("resize", update);
    return () => {
      document.body.classList.remove("debug-bounds-body");
      nav?.classList.remove("debug-bounds-nav");
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

/**
 * 表示するかどうか。
 *
 * ホーム画面から起動した場合、開始 URL が固定されるので問い合わせ文字列が残らない。
 * 実機で数値を見るあいだは既定で出しておき、`?debug=off` で消せるようにする。
 * 余白の調整が済んだら既定を false に戻す。
 */
export function layoutProbeEnabled(): boolean {
  return new URLSearchParams(window.location.search).get("debug") !== "off";
}
