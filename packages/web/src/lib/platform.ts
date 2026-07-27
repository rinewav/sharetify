/**
 * どこで開かれているか。
 *
 * 入れ物として配ったものと、閲覧環境で開いたものとでは、
 * 画面の上端の扱いが変わる。入れ物では枠を自前で持つ必要があり、
 * 掴んで動かせる場所も自分で用意しないといけない。
 */

/** 配って回す入れ物の中で開かれているか。 */
export function isDesktopApp(): boolean {
  return typeof navigator !== "undefined" && navigator.userAgent.includes("Electron");
}

/** 上端の丸いボタン (閉じる・しまう・広げる) が重なる側か。 */
export function isMacDesktopApp(): boolean {
  return isDesktopApp() && navigator.userAgent.includes("Mac");
}

/**
 * 開いた場所に応じた印を、いちばん外側に付ける。
 *
 * これを見て、掴める場所や上端の余白を出し分ける。
 * 閲覧環境で開いたときは何も付かないので、余計な隙間もできない。
 */
export function markPlatform(): void {
  const root = document.documentElement;
  if (isDesktopApp()) root.classList.add("is-desktop-app");
  if (isMacDesktopApp()) root.classList.add("is-mac-app");
}
