import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

/**
 * 曲を探して取ってくるための道具立て。
 *
 * この仕組みは、外の仕掛けを二つ借りている。
 * どちらも機械に元から入っているものではないので、
 * 配ったままでは何も探せないし鳴らせない。
 *
 * 手で入れてもらうのは酷なので、置き場を自分で用意して、
 * その中に入れる。機械に元から入っているものには触らない。
 */

const run = promisify(execFile);

/** 道具を置く場所。覚えておくものと同じ所にまとめる。 */
const HOME = join(homedir(), ".sharetify");
const VENV = join(HOME, "runtime");

/** 用意したあとに使う実行ファイル。 */
export const MANAGED_PYTHON = join(VENV, "bin", "python3");
export const MANAGED_RESOLVER = join(VENV, "bin", "yt-dlp");

/** Windows は置き場所の作りが違う。 */
const isWindows = process.platform === "win32";
const pythonPath = isWindows ? join(VENV, "Scripts", "python.exe") : MANAGED_PYTHON;
const resolverPath = isWindows ? join(VENV, "Scripts", "yt-dlp.exe") : MANAGED_RESOLVER;

export interface ToolchainStatus {
  /** そのまま使える状態か。 */
  ready: boolean;
  /** 曲の情報を引く仕掛けが使えるか。 */
  catalog: boolean;
  /** 音を取ってくる仕掛けが使えるか。 */
  resolver: boolean;
  /** 使う実行ファイルの場所。用意できていなければ null。 */
  python: string | null;
  resolverBin: string | null;
  /** 整っていないときの説明。 */
  message?: string;
}

/** 実行ファイルを試しに動かして、応えるかどうかを見る。 */
async function responds(bin: string, args: string[]): Promise<boolean> {
  try {
    await run(bin, args, { timeout: 10_000 });
    return true;
  } catch {
    return false;
  }
}

/** 用意した中に、目当てのものが入っているか。 */
async function hasModule(python: string, name: string): Promise<boolean> {
  return responds(python, ["-c", `import ${name}`]);
}

/**
 * いまの状態を調べる。
 *
 * 用意した置き場を先に見て、無ければ機械に元から入っているものを探す。
 * 自分で入れた人の環境を邪魔しないため。
 */
export async function inspectToolchain(): Promise<ToolchainStatus> {
  // 誰かが場所を指定しているなら、それに従う。
  const overridePython = process.env["SHARETIFY_PYTHON"];
  const overrideResolver = process.env["SHARETIFY_RESOLVER"];

  const pythonCandidates = [
    overridePython,
    existsSync(pythonPath) ? pythonPath : undefined,
    "python3",
  ].filter((p): p is string => Boolean(p));

  const resolverCandidates = [
    overrideResolver,
    existsSync(resolverPath) ? resolverPath : undefined,
    "yt-dlp",
  ].filter((p): p is string => Boolean(p));

  let python: string | null = null;
  for (const candidate of pythonCandidates) {
    if (await hasModule(candidate, "ytmusicapi")) {
      python = candidate;
      break;
    }
  }

  let resolverBin: string | null = null;
  for (const candidate of resolverCandidates) {
    if (await responds(candidate, ["--version"])) {
      resolverBin = candidate;
      break;
    }
  }

  const catalog = python !== null;
  const resolver = resolverBin !== null;

  return {
    ready: catalog && resolver,
    catalog,
    resolver,
    python,
    resolverBin,
    ...(catalog && resolver
      ? {}
      : {
          message: !catalog && !resolver
            ? "曲を探す仕掛けと、音を取ってくる仕掛けが、どちらも整っていません。"
            : !catalog
              ? "曲を探す仕掛けが整っていません。"
              : "音を取ってくる仕掛けが整っていません。",
        }),
  };
}

/**
 * 置き場を作るのに使える Python を探す。
 *
 * 音を取ってくる仕掛けは新しい Python でないと入らない。
 * 機械に元から入っているものは古いことがあり
 * (macOS の既定は 3.9、必要なのは 3.10 以上)、
 * それで作ると古い版しか入らず、供給元の変更に追いつけなくなる。
 * 使えるものを順に当たり、見つからなければその旨を伝える。
 */
async function findUsableBasePython(): Promise<string> {
  const named = process.env["SHARETIFY_BASE_PYTHON"];
  const candidates = [
    named,
    // 新しいものから順に当たる。
    "python3.14",
    "python3.13",
    "python3.12",
    "python3.11",
    "python3.10",
    "python3",
    "python",
  ].filter((p): p is string => Boolean(p));

  const found: string[] = [];
  for (const candidate of candidates) {
    const version = await pythonVersion(candidate);
    if (!version) continue;
    found.push(`${candidate} (${version.major}.${version.minor})`);
    // 3.10 以上でないと、音を取ってくる仕掛けが新しくならない。
    if (version.major > 3 || (version.major === 3 && version.minor >= 10)) return candidate;
  }

  throw new Error(
    found.length > 0
      ? `使える Python が古すぎます (見つかったもの: ${found.join(", ")})。` +
        "3.10 以上を入れてから、もう一度お試しください。"
      : "この機械には Python が見当たりません。先に Python を入れてから、もう一度お試しください。",
  );
}

/** その Python の版を調べる。動かなければ null。 */
async function pythonVersion(bin: string): Promise<{ major: number; minor: number } | null> {
  try {
    const { stdout } = await run(bin, ["--version"], { timeout: 10_000 });
    const matched = /Python (\d+)\.(\d+)/.exec(stdout);
    if (!matched) return null;
    return { major: Number(matched[1]), minor: Number(matched[2]) };
  } catch {
    return null;
  }
}

export type SetupProgress = (step: string, detail?: string) => void;

/**
 * 足りないものを入れる。
 *
 * 機械に元から入っているものには触らない。
 * 専用の置き場を作って、その中だけで完結させる。
 * 消したくなったら、その置き場ごと捨てれば元に戻る。
 */
export async function installToolchain(onProgress: SetupProgress = () => {}): Promise<ToolchainStatus> {
  await mkdir(HOME, { recursive: true });

  /*
   * 置き場がまだ無いか、そこが古すぎるなら作り直す。
   *
   * 古い Python で作った置き場には、音を取ってくる仕掛けの新しいものが
   * 入らない。入らないまま使い続けると、供給元の変更に追いつけず
   * 「再生できませんでした」になる。
   */
  const current = existsSync(pythonPath) ? await pythonVersion(pythonPath) : null;
  const tooOld = current !== null && current.major === 3 && current.minor < 10;

  if (!existsSync(pythonPath) || tooOld) {
    if (tooOld) {
      onProgress("置き場を作り直しています");
      await rm(VENV, { recursive: true, force: true });
    } else {
      onProgress("置き場を作っています");
    }
    const base = await findUsableBasePython();
    await run(base, ["-m", "venv", VENV], { timeout: 120_000 });
  }

  /*
   * 入れる道具を新しくしておく。
   * 古いままだと、入れようとしたものを取ってこられないことがある。
   */
  onProgress("下ごしらえをしています");
  await run(pythonPath, ["-m", "pip", "install", "--upgrade", "pip"], {
    timeout: 180_000,
  }).catch(() => undefined);

  onProgress("曲を探す仕掛けを入れています", "ytmusicapi");
  await run(pythonPath, ["-m", "pip", "install", "--upgrade", "ytmusicapi"], {
    timeout: 300_000,
  });

  onProgress("音を取ってくる仕掛けを入れています", "yt-dlp");
  await run(pythonPath, ["-m", "pip", "install", "--upgrade", "yt-dlp"], {
    timeout: 300_000,
  });

  onProgress("確かめています");
  const status = await inspectToolchain();
  if (!status.ready) {
    throw new Error(status.message ?? "うまく整いませんでした。");
  }
  return status;
}

/**
 * 音を取ってくる仕掛けだけを新しくする。
 *
 * 供給元の作りが変わると古いものでは取れなくなる。
 * 全部入れ直さなくても、これだけ新しくすれば直ることが多い。
 */
export async function updateResolver(onProgress: SetupProgress = () => {}): Promise<void> {
  if (!existsSync(pythonPath)) throw new Error("まだ置き場が用意されていません。");
  onProgress("音を取ってくる仕掛けを新しくしています");
  await run(pythonPath, ["-m", "pip", "install", "--upgrade", "yt-dlp"], { timeout: 300_000 });
}
