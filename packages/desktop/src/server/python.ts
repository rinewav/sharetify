import { execFile } from "node:child_process";
import { createWriteStream, existsSync } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { promisify } from "node:util";

/**
 * Python そのものを用意する。
 *
 * 曲を探して取ってくる仕掛けは、どちらも Python で書かれている。
 * だが Python はパソコンに元から入っているとは限らない。
 * Windows には無いことが多く、macOS に入っているものは古い
 * (既定は 3.9、必要なのは 3.10 以上)。
 *
 * 「先に Python を入れてください」と突き放すのは酷なので、
 * 無ければこちらで用意する。入れるのは専用の置き場の中だけで、
 * パソコンに元から入っているものには触らないし、管理者の許しも要らない。
 * 要らなくなったら置き場ごと捨てれば元に戻る。
 */

const run = promisify(execFile);

const HOME = join(homedir(), ".sharetify");
/** 自前で用意した Python の置き場。venv とは別にする。 */
const RUNTIME = join(HOME, "python");

const isWindows = process.platform === "win32";

/** 用意したあとに現れる実行ファイル。 */
const MANAGED = isWindows
  ? join(RUNTIME, "python", "python.exe")
  : join(RUNTIME, "python", "bin", "python3");

/**
 * 取ってくる版。
 *
 * 新しすぎると、曲を取ってくる仕掛けが追いついていないことがある。
 * 枯れていて、かつ必要な下限を満たすものを選ぶ。
 */
const WANT = "3.12";

/** 取ってくる先。同じものを配っている、素性のはっきりした置き場。 */
const RELEASES = "https://api.github.com/repos/astral-sh/python-build-standalone/releases/latest";

export type Progress = (step: string, detail?: string) => void;

/** いま動いているパソコンに合う版の呼び名。 */
function tripleForHere(): string {
  if (isWindows) return "x86_64-pc-windows-msvc";
  if (process.platform === "darwin") {
    return process.arch === "arm64" ? "aarch64-apple-darwin" : "x86_64-apple-darwin";
  }
  return process.arch === "arm64" ? "aarch64-unknown-linux-gnu" : "x86_64-unknown-linux-gnu";
}

/** その Python の版を調べる。動かなければ null。 */
export async function pythonVersion(bin: string): Promise<{ major: number; minor: number } | null> {
  try {
    const { stdout, stderr } = await run(bin, ["--version"], { timeout: 10_000 });
    const matched = /Python (\d+)\.(\d+)/.exec(stdout || stderr);
    if (!matched) return null;
    return { major: Number(matched[1]), minor: Number(matched[2]) };
  } catch {
    return null;
  }
}

/** 曲を取ってくる仕掛けが動く新しさか。 */
export function isNewEnough(version: { major: number; minor: number } | null): boolean {
  if (!version) return false;
  return version.major > 3 || (version.major === 3 && version.minor >= 10);
}

/**
 * すぐ使える Python を探す。
 *
 * 自前で用意したものを先に見て、無ければパソコンに入っているものを当たる。
 * どちらも無ければ null。取ってくるかどうかは呼ぶ側が決める。
 */
export async function findPython(): Promise<string | null> {
  const named = process.env["SHARETIFY_BASE_PYTHON"];
  const candidates = [
    named,
    existsSync(MANAGED) ? MANAGED : undefined,
    // 新しいものから順に当たる。
    "python3.14",
    "python3.13",
    "python3.12",
    "python3.11",
    "python3.10",
    "python3",
    "python",
  ].filter((p): p is string => Boolean(p));

  for (const candidate of candidates) {
    if (isNewEnough(await pythonVersion(candidate))) return candidate;
  }
  return null;
}

/** 広げる道具があるか。macOS には元からあり、Windows も 10 の途中から入っている。 */
async function canExtract(): Promise<boolean> {
  try {
    await run("tar", ["--version"], { timeout: 10_000 });
    return true;
  } catch {
    return false;
  }
}

/** 配っているものの中から、このパソコンに合うものを選ぶ。 */
async function findDownload(): Promise<{ url: string; name: string }> {
  const triple = tripleForHere();

  const response = await fetch(RELEASES, {
    headers: { Accept: "application/vnd.github+json" },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error("Python の配布元に接続できませんでした。ネットワーク接続を確認してください。");

  const release = (await response.json()) as {
    assets?: { name: string; browser_download_url: string }[];
  };

  /*
   * 名前で選ぶ。
   *
   * install_only は、そのまま置けば動く形。作るための道具は入っていない。
   * stripped は目印を削ったもので、こちらのほうが小さい。
   * freethreaded は作りが違うので避ける。
   */
  const wanted = (release.assets ?? []).filter(
    (asset) =>
      asset.name.startsWith(`cpython-${WANT}.`) &&
      asset.name.includes(triple) &&
      asset.name.includes("install_only") &&
      !asset.name.includes("freethreaded") &&
      !asset.name.endsWith(".sha256"),
  );

  // 小さいほうを選ぶ。中身は同じで、目印が削ってあるだけ。
  const picked =
    wanted.find((asset) => asset.name.includes("stripped")) ?? wanted[0];

  if (!picked) throw new Error(`この環境 (${triple}) に対応する Python が見つかりませんでした。`);
  return { url: picked.browser_download_url, name: picked.name };
}

/**
 * Python を取ってきて置く。
 *
 * 途中で失敗したものを残さない。次に開いたときに
 * 「あるのに動かない」状態になると、原因が分からなくなる。
 */
export async function installPython(onProgress: Progress = () => {}): Promise<string> {
  if (existsSync(MANAGED) && isNewEnough(await pythonVersion(MANAGED))) return MANAGED;

  /*
   * 広げる道具があるかを先に見る。
   *
   * 取ってきてから無いと分かるより、始める前に断ったほうがよい。
   * Windows 10 の古いものには入っていないことがある。
   */
  if (!(await canExtract())) {
    throw new Error(
      "アーカイブの展開に必要な tar コマンドが見つかりません。" +
        "Python 3.10 以上を手動でインストールしてから、もう一度お試しください。",
    );
  }

  onProgress("Python を確認しています");
  const { url, name } = await findDownload();

  await rm(RUNTIME, { recursive: true, force: true });
  await mkdir(RUNTIME, { recursive: true });

  const archive = join(RUNTIME, "download.tar.gz");

  try {
    onProgress("Python をダウンロードしています", name);
    const response = await fetch(url, { signal: AbortSignal.timeout(10 * 60_000) });
    if (!response.ok || !response.body) throw new Error("Python のダウンロードに失敗しました。");

    /*
     * 受け取りながら書き出す。
     * 一度に読み込むと、そのぶんの場所を丸ごと使うことになる。
     */
    await pipeline(Readable.fromWeb(response.body as never), createWriteStream(archive));

    onProgress("Python を展開しています");
    /*
     * 広げるのは、パソコンに元から入っている道具に任せる。
     * Windows 10 以降にも tar があるので、これで両方まかなえる。
     */
    await run("tar", ["-xzf", archive, "-C", RUNTIME], { timeout: 10 * 60_000 });

    if (!existsSync(MANAGED)) throw new Error("Python の展開に失敗しました。");

    const version = await pythonVersion(MANAGED);
    if (!isNewEnough(version)) throw new Error("ダウンロードした Python のバージョンが古すぎます。");

    onProgress("Python を準備しました", `${version!.major}.${version!.minor}`);
    return MANAGED;
  } catch (error) {
    // 半端に残ると、次に「あるのに動かない」状態になる。
    await rm(RUNTIME, { recursive: true, force: true });
    throw error;
  } finally {
    await rm(archive, { force: true }).catch(() => undefined);
  }
}

/**
 * 使える Python を用意する。
 *
 * 既にあるならそれを使う。無ければ取ってくる。
 * どちらの道を通ったかは呼ぶ側から見えなくてよい。
 */
export async function ensurePython(onProgress: Progress = () => {}): Promise<string> {
  const found = await findPython();
  if (found) return found;
  return installPython(onProgress);
}
