import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, renameSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * 両方の作りに対応した入れ物を作るための下ごしらえ。
 *
 * 直に機械へ触れる部品は、作りごとに別のものが要る。
 * 取り込むときは動かしている機械の分しか入らないので、
 * もう片方を取ってきて、二つを一つに束ねておく。
 *
 * 束ねておかないと、包む段で「両方に同じものが入っている」と怒られる。
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
if (!existsSync(built)) throw new Error(`${built} がありません`);

/** いま入っているものが、どちらの作り向けか。 */
function archOf(path) {
  const info = execFileSync("file", [path], { encoding: "utf8" });
  if (info.includes("arm64")) return "arm64";
  if (info.includes("x86_64")) return "x64";
  return "unknown";
}

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
  execFileSync(
    "npx",
    ["prebuild-install", "-r", "napi", "--arch", arch, "--platform", "darwin"],
    { cwd: moduleDir, stdio: "inherit" },
  );
  const got = archOf(built);
  if (got !== arch) throw new Error(`${arch} のつもりが ${got} でした`);
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

// 束ねたものを、本来の場所へ戻す
renameSync(merged, built);

/*
 * 作業に使った控えは片付ける。
 * 残しておくと、包む段で「両方に同じものが入っている」と怒られる。
 */
rmSync(stash, { recursive: true, force: true });

console.log(`束ねました: ${execFileSync("file", [built], { encoding: "utf8" }).trim()}`);
