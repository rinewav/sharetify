import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { type BrowserWindow, nativeImage, nativeTheme } from "electron";

/**
 * Windows で、タスクバーの絵に指を乗せたときに出る小さな操作盤。
 *
 * 窓を出さずに、戻る・止める・進むだけを済ませたいことがある。
 * ほかの音楽ものは大抵これを持っていて、無いと「効かない」と思われる。
 *
 * macOS と Linux には同じ場所が無いので、そこでは何もしない。
 * (macOS は Dock の右押しに出る品書きが近いが、別の仕組みなのでここでは扱わない)
 */

const HERE = dirname(fileURLToPath(import.meta.url));

export type MediaCommand = "prev" | "toggle" | "next";

/** 画面から届く、いまの様子。 */
export interface PlaybackState {
  playing: boolean;
  /** 操作してよいか。ほかの人の場に相乗りしている間は握らせない。 */
  controllable: boolean;
  /** 並びに曲があるか。空のまま押せると、押しても何も起きない。 */
  hasTrack: boolean;
}

const IDLE: PlaybackState = { playing: false, controllable: true, hasTrack: false };

let latest: PlaybackState = IDLE;
let target: BrowserWindow | null = null;
let onCommand: ((command: MediaCommand) => void) | null = null;
let watchingTheme = false;

/**
 * ボタンの絵を探す。
 *
 * 包んだあとは resources の隣、開発中は build の下にある。
 * 見つからないときは空の絵を返す。絵が無くても押せる場所は残る。
 */
function icon(name: string): Electron.NativeImage {
  /*
   * タスクバーの背景は設定で明るくも暗くもなる。
   * 白い絵だけを持たせると、明るい配色のときに何も見えなくなる。
   */
  const tone = nativeTheme.shouldUseDarkColors ? "dark" : "light";
  const file = `${name}-${tone}.png`;

  const candidates = [
    join(process.resourcesPath ?? "", "thumbar", file),
    join(HERE, "..", "build", "thumbar", file),
    join(HERE, "..", "..", "build", "thumbar", file),
  ];

  const found = candidates.find((path) => path && existsSync(path));
  if (!found) {
    console.warn(`[sharetify] タスクバーのボタンの絵が見つかりません: ${file}`);
    return nativeImage.createEmpty();
  }
  return nativeImage.createFromPath(found);
}

/** 並べ直す。押せるかどうかと、止める / 流すの絵はその時々で変わる。 */
function render(): void {
  if (process.platform !== "win32") return;
  if (!target || target.isDestroyed()) return;

  const usable = latest.controllable && latest.hasTrack;
  const flags: ("disabled" | "dismissonclick")[] = usable ? [] : ["disabled"];

  target.setThumbarButtons([
    {
      tooltip: "前の曲",
      icon: icon("prev"),
      flags,
      click: () => onCommand?.("prev"),
    },
    {
      tooltip: latest.playing ? "一時停止" : "再生",
      icon: icon(latest.playing ? "pause" : "play"),
      flags,
      click: () => onCommand?.("toggle"),
    },
    {
      tooltip: "次の曲",
      icon: icon("next"),
      flags,
      click: () => onCommand?.("next"),
    },
  ]);
}

/**
 * 窓に操作盤を付ける。
 *
 * 窓は閉じても作り直されることがあるので、そのたびに呼び直す。
 * 覚えている様子はそのまま使うので、付け直しても絵は食い違わない。
 */
export function attachThumbar(
  window: BrowserWindow,
  handler: (command: MediaCommand) => void,
): void {
  if (process.platform !== "win32") return;

  target = window;
  onCommand = handler;

  /*
   * 配色が変わったら描き直す。
   * 明るい配色に切り替えた人の手元で、白い絵のまま消えてしまわないように。
   */
  if (!watchingTheme) {
    watchingTheme = true;
    nativeTheme.on("updated", render);
  }

  render();
}

/** 画面から届いた様子を映す。変わっていなければ触らない。 */
export function updateThumbar(state: PlaybackState): void {
  if (process.platform !== "win32") return;

  const same =
    latest.playing === state.playing &&
    latest.controllable === state.controllable &&
    latest.hasTrack === state.hasTrack;
  latest = state;
  if (same) return;

  render();
}

/** 窓が消えたときに呼ぶ。次に開いたら付け直す。 */
export function detachThumbar(): void {
  target = null;
  latest = IDLE;
}
