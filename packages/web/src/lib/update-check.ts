/**
 * 新しい版が出ていないかを確かめる。
 *
 * デスクトップアプリは自分では新しくならないので、
 * 出ていることに気づける場所がないと、古いまま使い続けることになる。
 * ブラウザで開いている場合は常に配られた最新なので、確かめない。
 *
 * 確かめる先は GitHub のリリース。リポジトリが非公開の間は
 * 404 が返るだけなので、静かに何もしない。公開したら自然に効き始める。
 */

const LATEST_API = "https://api.github.com/repos/rinewav/sharetify/releases/latest";
export const RELEASES_PAGE = "https://github.com/rinewav/sharetify/releases/latest";

/** 「この版は知らせた」の控え。同じ版で何度も知らせない。 */
const DISMISSED_KEY = "sharetify.update-dismissed";

/** 確かめる間隔。急ぐものではない。 */
const CHECK_INTERVAL_MS = 6 * 60 * 60_000;

export interface UpdateInfo {
  /** 新しい版の名前。例: 0.1.0 */
  version: string;
  url: string;
}

/** "v0.1.0" → [0, 1, 0]。読めない形なら null。 */
function parseVersion(raw: string): number[] | null {
  const matched = /^v?(\d+(?:\.\d+)*)/.exec(raw.trim());
  if (!matched) return null;
  return matched[1]!.split(".").map(Number);
}

/** a が b より新しいか。桁が足りないところは 0 と見なす。 */
export function isNewer(a: string, b: string): boolean {
  const left = parseVersion(a);
  const right = parseVersion(b);
  if (!left || !right) return false;

  const length = Math.max(left.length, right.length);
  for (let i = 0; i < length; i += 1) {
    const x = left[i] ?? 0;
    const y = right[i] ?? 0;
    if (x !== y) return x > y;
  }
  return false;
}

function dismissed(): string | null {
  try {
    return localStorage.getItem(DISMISSED_KEY);
  } catch {
    return null;
  }
}

/** この版のことは、もう知らせない。 */
export function dismissUpdate(version: string): void {
  try {
    localStorage.setItem(DISMISSED_KEY, version);
  } catch {
    // 覚えられなければ、次に開いたときにまた出るだけ。
  }
}

/**
 * いま出ている最新の版を訊く。
 *
 * 現行版より新しく、まだ知らせていないものだけを返す。
 * 訊けないとき (非公開・回線なし・回数制限) は null。
 */
export async function checkForUpdate(currentVersion: string): Promise<UpdateInfo | null> {
  try {
    const response = await fetch(LATEST_API, {
      headers: { Accept: "application/vnd.github+json" },
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) return null;

    const release = (await response.json()) as { tag_name?: string; html_url?: string };
    const latest = release.tag_name;
    if (!latest || !isNewer(latest, currentVersion)) return null;

    const plain = latest.replace(/^v/, "");
    if (dismissed() === plain) return null;

    return { version: plain, url: release.html_url ?? RELEASES_PAGE };
  } catch {
    return null;
  }
}

/**
 * 折々に確かめて、見つけたら知らせる。
 *
 * 戻り値は止めるための関数。画面が入れ替わるときに呼ぶ。
 */
export function watchForUpdate(
  currentVersion: () => string | null,
  onFound: (info: UpdateInfo) => void,
): () => void {
  let stopped = false;

  const look = async () => {
    if (stopped) return;
    const version = currentVersion();
    if (!version) return;
    const info = await checkForUpdate(version);
    if (info && !stopped) onFound(info);
  };

  void look();
  const timer = setInterval(() => void look(), CHECK_INTERVAL_MS);
  // 手で確かめ直したいとき (動作確認を含む) のための入口。
  const onDemand = () => void look();
  window.addEventListener("sharetify:check-update", onDemand);

  return () => {
    stopped = true;
    clearInterval(timer);
    window.removeEventListener("sharetify:check-update", onDemand);
  };
}
