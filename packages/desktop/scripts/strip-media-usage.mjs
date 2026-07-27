import { execFileSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * 使わない機器の断り書きを、包んだあとの名札から消す。
 *
 * macOS は「マイクを使ってよいか」と持ち主に訊ねるとき、
 * アプリの名札 (Info.plist) に書かれた断り書きを読み上げる。
 * 裏を返せば、断り書きが無ければ訊ねようがない。
 *
 * 中身は Electron から借りた名札をそのまま持っており、
 * そこには使う予定のないマイク・カメラ・Bluetooth の断り書きが最初から入っている。
 * 鳴らし先を数える処理がついでに録り口を覗いたとき、
 * これが残っていると持ち主に許可を訊ねる窓が出てしまう。
 *
 * 名札から消しておけば、訊ねる窓そのものが出なくなる。
 * (main.ts 側でも要求を断っているので、ここは二重の備え)
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

export default async function stripMediaUsage(context) {
  if (context.electronPlatformName !== "darwin") return;

  const appPath = join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  if (!existsSync(appPath)) return;

  for (const plist of collectPlists(appPath)) stripFrom(plist);

  console.log("[sharetify] 使わない機器の断り書きを名札から消しました");
}
