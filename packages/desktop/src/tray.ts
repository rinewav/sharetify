import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Menu, Tray, app, nativeImage } from "electron";
import { loadStartupSettings, setOpenAtLogin } from "./startup.js";

/**
 * 上端 (Windows なら通知領域) に置く小さな入口。
 *
 * このアプリは窓を閉じても裏で待ち続ける。
 * ところが Windows では、窓を閉じるとタスクバーからも消えてしまい、
 * 動いているのに呼び戻す手立てが無くなる。
 * macOS も同じで、Dock から消す設定にしていれば戻れない。
 *
 * 動き続けるなら、いつでも呼び戻せる場所と、
 * きちんと終わらせる手立ての両方が要る。ここがその両方を持つ。
 */

const HERE = dirname(fileURLToPath(import.meta.url));

let tray: Tray | null = null;

/** 上端に出す絵。並びの高さに合わせて小さくする。 */
function trayIcon(): Electron.NativeImage {
  /*
   * 包んだあとは resources の隣に、開発中は build に置いてある。
   * どちらにも無ければ空の絵で作る。絵が無くても入口は要る。
   */
  const candidates = [
    join(process.resourcesPath ?? "", "icon.png"),
    join(HERE, "..", "build", "icon.png"),
    join(HERE, "..", "..", "build", "icon.png"),
  ];

  const found = candidates.find((path) => path && existsSync(path));
  if (!found) {
    console.warn("[sharetify] 上端に出す絵が見つかりません", candidates);
    return nativeImage.createEmpty();
  }

  const image = nativeImage.createFromPath(found);
  if (image.isEmpty()) {
    console.warn(`[sharetify] 上端に出す絵を読めません: ${found}`);
    return image;
  }

  /*
   * 高さに合わせて縮める。
   *
   * 元の絵は配布用の大きなもので、そのまま渡すと並びが押し広げられる。
   * macOS は色を持たない絵として扱わせると、明るい背景でも暗い背景でも
   * 見えるように OS が塗り分けてくれる。
   */
  const small = image.resize({ width: 18, height: 18 });
  if (process.platform === "darwin") small.setTemplateImage(true);
  return small;
}

export interface TrayHandlers {
  /** 窓を前に出す。閉じていれば開き直す。 */
  onOpen: () => void;
  /** 本当に終わらせる。 */
  onQuit: () => void;
}

export async function createTray(handlers: TrayHandlers): Promise<void> {
  if (tray) return;

  const icon = trayIcon();
  tray = new Tray(icon);
  tray.setToolTip("Sharetify");
  console.log(`[sharetify] 上端に入口を出しました (絵: ${icon.isEmpty() ? "無し" : "有り"})`);

  await refreshTrayMenu(handlers);

  /*
   * 押したら開く。
   *
   * Windows では絵を押しても品書きは出ないので、押下を開く合図にする。
   * macOS は押すと品書きが出るのが習わしなので、そちらに任せる。
   */
  if (process.platform !== "darwin") {
    tray.on("click", handlers.onOpen);
  }
}

/** 品書きを組み直す。切り替えた印をその場に映すために使う。 */
export async function refreshTrayMenu(handlers: TrayHandlers): Promise<void> {
  if (!tray) return;

  const settings = await loadStartupSettings();

  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "Sharetify を開く", click: handlers.onOpen },
      { type: "separator" },
      {
        label: "パソコンと一緒に起ち上げる",
        type: "checkbox",
        checked: settings.openAtLogin,
        /*
         * 包む前は名簿に載せられない。押せると直ったように見えてしまうので、
         * 触れないようにしておく。
         */
        enabled: app.isPackaged,
        click: async (item) => {
          await setOpenAtLogin(item.checked);
          await refreshTrayMenu(handlers);
        },
      },
      { type: "separator" },
      {
        label: "Sharetify を終了",
        /*
         * ここだけが本当の終わり。
         *
         * 窓を閉じただけでは待ち受ける役目は続く。
         * 終わらせたい人が迷わないよう、はっきり分けて置く。
         */
        click: handlers.onQuit,
      },
    ]),
  );
}

export function destroyTray(): void {
  tray?.destroy();
  tray = null;
}
