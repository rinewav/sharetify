import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, renameSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * 直に機械へ触れる部品を、配る先に合わせて入れ替える。
 *
 * 取り込むときは、動かしている機械の分しか入らない。
 * 別の機械向けに包むなら、その分を取ってきて置き換える必要がある。
 *
 *   mac  … 二つの作りを一つに束ねる (universal)
 *   win  … Windows 用のものに差し替える
 *
 * 使い方: node scripts/prepare-native.mjs mac|win
 */

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..", "..");

/** 直に機械へ触れる部品の置き場を探す。 */
function findNativeModule(name) {
  const base = join(root, "node_modules", ".pnpm");
  const dirs = execFileSync("ls", [base], { encoding: "utf8" })
    .split("\n")
    .filter((d) => d.startsWith(`${name}@`));
  if (dirs.length === 0) throw new Error(`${name} が見つかりません`);
  return join(base, dirs[0], "node_modules", name);
}

const moduleDir = findNativeModule("node-datachannel");
const built = join(moduleDir, "build", "Release", "node_datachannel.node");

/** 取ってくる。何度呼んでも同じ結果になる。 */
function fetchPrebuilt(platform, arch) {
  execFileSync(
    "npx",
    ["prebuild-install", "-r", "napi", "--arch", arch, "--platform", platform],
    { cwd: moduleDir, stdio: "inherit" },
  );
  if (!existsSync(built)) throw new Error(`${platform}-${arch} を取ってこられませんでした`);
}

function describe(path) {
  return execFileSync("file", [path], { encoding: "utf8" }).trim();
}

const target = process.argv[2];

if (target === "dev") {
  /*
   * 手元で動かすための形に戻す。
   *
   * 配る支度をすると、この機械では読めない形に置き換わることがある。
   * 支度のあとそのままにしておくと、次に手元で動かしたときに倒れる。
   */
  const arch = process.arch === "arm64" ? "arm64" : "x64";
  console.log(`手元 (darwin-${arch}) の形に戻します…`);
  fetchPrebuilt("darwin", arch);
  console.log(`戻しました: ${describe(built)}`);
} else if (target === "win") {
  console.log("Windows x64 の部品に差し替えます…");
  fetchPrebuilt("win32", "x64");
  console.log(`用意できました: ${describe(built)}`);
} else if (target === "mac") {
  /*
   * 作業用の控えは、包む対象の外に置く。
   * 中に置くと、片付ける前に拾われてしまうことがある。
   */
  const stash = join(root, "node_modules", ".universal-native");
  mkdirSync(stash, { recursive: true });

  /*
   * 二つとも取り直す。
   *
   * いま入っているものが既に束ねたものだと、そこから片方を取り出せない。
   * 毎回どちらも取ってくれば、何度走らせても同じ結果になる。
   */
  for (const arch of ["arm64", "x64"]) {
    console.log(`${arch} を取ってきます…`);
    fetchPrebuilt("darwin", arch);
    copyFileSync(built, join(stash, `${arch}.node`));
  }

  // 二つを一つに束ねる
  const merged = join(stash, "universal.node");
  execFileSync("lipo", [
    "-create",
    join(stash, "arm64.node"),
    join(stash, "x64.node"),
    "-output",
    merged,
  ]);
  renameSync(merged, built);

  /*
   * 作業に使った控えは片付ける。
   * 残しておくと、包む段で「両方に同じものが入っている」と怒られる。
   */
  rmSync(stash, { recursive: true, force: true });
  console.log(`束ねました: ${describe(built)}`);
} else {
  console.error("mac か win を指定してください");
  process.exit(1);
}
