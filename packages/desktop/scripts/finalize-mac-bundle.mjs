import { execFileSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * 包み上がった mac 版に、配る前の仕上げをふたつ施す。
 *
 *   1. 使わない機器の断り書きを名札から消す
 *   2. 名前を持たない印を押す (ad-hoc 署名)
 *
 * どちらも「マイクを使ってよいか」と何度も訊かれるのを止めるためのもの。
 *
 * 1 は訊ねる文句の出どころを断つ。
 * 2 のほうが効きが大きい。印がまったく無いと、macOS はアプリの中身を
 * 照合できず、同じアプリだと見分けられない。一度許してもらっても
 * 覚えておけず、手伝い役の数だけ何度も訊きにいってしまう。
 * 印を押しておけば中身の指紋が定まり、一度で覚えてもらえる。
 *
 * 正式な印 (Developer ID) は持っていないので名前は伏せたままだが、
 * 見分けがつくようになるという点では同じ働きをする。
 */

/** 使わないので消してよい断り書き。 */
const UNUSED = [
  "NSMicrophoneUsageDescription",
  "NSCameraUsageDescription",
  "NSBluetoothAlwaysUsageDescription",
  "NSBluetoothPeripheralUsageDescription",
];

/** 名札ひとつぶんを削る。無ければ何もしない。 */
function stripFrom(plist) {
  if (!existsSync(plist)) return;

  for (const key of UNUSED) {
    try {
      execFileSync("plutil", ["-remove", key, plist], { stdio: "ignore" });
    } catch {
      // もともと書かれていなかっただけなので、そのまま次へ進む。
    }
  }
}

/**
 * 中に入っている手伝い役の名札まで辿る。
 *
 * 実際に機器へ触れにいくのは、外側の本体ではなく Frameworks の中の手伝い役。
 * 外側だけ消しても、そちらに残っていると意味が薄い。
 */
function collectPlists(appPath) {
  const found = [join(appPath, "Contents", "Info.plist")];
  const frameworks = join(appPath, "Contents", "Frameworks");

  if (!existsSync(frameworks)) return found;

  for (const entry of readdirSync(frameworks)) {
    if (!entry.endsWith(".app")) continue;
    found.push(join(frameworks, entry, "Contents", "Info.plist"));
  }

  return found;
}

/**
 * 名前を伏せた印を押す。
 *
 * 押す順は内側から外側へ。外側を先に押すと、あとから中身を触った時点で
 * 外側の印が合わなくなる。手伝い役・枠組み・その中の小物まで数が多く、
 * 取りこぼすと外側を押す段で撥ねられるので、潜って順に押す指示 (--deep) に任せる。
 */
function signAdHoc(appPath) {
  execFileSync("codesign", ["--force", "--deep", "--sign", "-", "--timestamp=none", appPath], {
    stdio: "ignore",
  });

  // 押せているか確かめる。ここで通らないなら配っても意味がない。
  execFileSync("codesign", ["--verify", "--deep", appPath], { stdio: "ignore" });
}

export default async function finalizeMacBundle(context) {
  if (context.electronPlatformName !== "darwin") return;

  const appPath = join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  if (!existsSync(appPath)) return;

  for (const plist of collectPlists(appPath)) stripFrom(plist);
  console.log("[sharetify] 使わない機器の断り書きを名札から消しました");

  /*
   * 二つの作りを束ねる前の下ごしらえには印を押さない。
   * 束ねる段で作り直されるので、ここで押しても捨てられる。
   */
  if (context.appOutDir.endsWith("-temp")) return;

  signAdHoc(appPath);
  console.log("[sharetify] 名前を伏せた印を押しました (ad-hoc)");
}
