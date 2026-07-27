import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { ensurePython, isNewEnough, pythonVersion } from "./python.js";

/**
 * 曲を探して取ってくるための道具立て。
 *
 * この仕組みは、外の仕掛けを二つ借りている。
 * どちらもパソコンに元から入っているものではないので、
 * 配ったままでは何も探せないし鳴らせない。
 *
 * 手で入れてもらうのは酷なので、置き場を自分で用意して、
 * その中に入れる。パソコンに元から入っているものには触らない。
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
 * 用意した置き場を先に見て、無ければパソコンに元から入っているものを探す。
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
            ? "検索エンジンとダウンローダーが、どちらもインストールされていません。"
            : !catalog
              ? "検索エンジンがインストールされていません。"
              : "ダウンローダーがインストールされていません。",
        }),
  };
}

export type SetupProgress = (step: string, detail?: string) => void;

/**
 * 足りないものを入れる。
 *
 * パソコンに元から入っているものには触らない。
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
  const tooOld = existsSync(pythonPath) && !isNewEnough(current);

  if (!existsSync(pythonPath) || tooOld) {
    /*
     * 先に、置き場を作れる Python を確かめる。
     *
     * パソコンに無ければ、こちらで取ってくる。突き放しても
     * 何をどう入れればよいかは伝わらないし、入れたところで
     * 版が合わなければ同じところで止まる。
     */
    const base = await ensurePython(onProgress);

    if (tooOld) {
      onProgress("実行環境を作り直しています");
      await rm(VENV, { recursive: true, force: true });
    } else {
      onProgress("実行環境を作成しています");
    }
    await run(base, ["-m", "venv", VENV], { timeout: 180_000 });
  }

  /*
   * 入れる道具を新しくしておく。
   * 古いままだと、入れようとしたものを取ってこられないことがある。
   */
  onProgress("パッケージ管理ツールを更新しています");
  await run(pythonPath, ["-m", "pip", "install", "--upgrade", "pip"], {
    timeout: 180_000,
  }).catch(() => undefined);

  onProgress("検索エンジンをインストールしています", "ytmusicapi");
  await run(pythonPath, ["-m", "pip", "install", "--upgrade", "ytmusicapi"], {
    timeout: 300_000,
  });

  onProgress("ダウンローダーをインストールしています", "yt-dlp");
  await run(pythonPath, ["-m", "pip", "install", "--upgrade", "yt-dlp"], {
    timeout: 300_000,
  });

  onProgress("動作を確認しています");
  const status = await inspectToolchain();
  if (!status.ready) {
    throw new Error(status.message ?? "セットアップに失敗しました。");
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
  if (!existsSync(pythonPath)) throw new Error("実行環境がまだ作成されていません。");
  onProgress("ダウンローダーを更新しています");
  await run(pythonPath, ["-m", "pip", "install", "--upgrade", "yt-dlp"], { timeout: 300_000 });
}
