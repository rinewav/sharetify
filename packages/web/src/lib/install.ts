import { useEffect, useState } from "react";

/**
 * ホーム画面に置いてもらうための下ごしらえ。
 *
 * 閲覧環境の中で開いたままだと、画面を消したときに音が止まる端末がある。
 * ホーム画面から開けば独立した入れ物として扱われ、そこが解消する。
 * だから「入れてもらう」ことには意味がある。
 */

/** 入れる操作を、こちらの都合の良いときに出せるよう取っておく。 */
interface InstallPrompt extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

let deferred: InstallPrompt | null = null;

if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (event) => {
    // 既定の出し方に任せると、こちらの説明より先に出てしまう。
    event.preventDefault();
    deferred = event as InstallPrompt;
  });
}

/** ホーム画面から開かれているか。 */
export function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    // iOS はこちらでしか分からない。
    (navigator as { standalone?: boolean }).standalone === true
  );
}

export function isIos(): boolean {
  if (typeof navigator === "undefined") return false;
  return (
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    // iPad は Mac として名乗ることがある。触れるかどうかで見分ける。
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  );
}

/**
 * 入れてもらう案内を出すべきか。
 *
 * 既に入っている人、そもそも入れる仕組みが無い所では出さない。
 */
export function useInstallState() {
  const [canPrompt, setCanPrompt] = useState(deferred !== null);

  useEffect(() => {
    const onAvailable = () => setCanPrompt(true);
    const onInstalled = () => {
      deferred = null;
      setCanPrompt(false);
    };
    window.addEventListener("beforeinstallprompt", onAvailable);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onAvailable);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  return {
    /** 入れる操作をこちらから出せるか。 */
    canPrompt,
    /** 既にホーム画面から開かれているか。 */
    installed: isStandalone(),
    /** iOS は自分で操作してもらうしかない。手順を示す必要がある。 */
    needsManualSteps: isIos() && !isStandalone(),
    /** 取っておいた操作を出す。 */
    async promptInstall(): Promise<"accepted" | "dismissed" | "unavailable"> {
      if (!deferred) return "unavailable";
      await deferred.prompt();
      const { outcome } = await deferred.userChoice;
      deferred = null;
      setCanPrompt(false);
      return outcome;
    },
  };
}
