import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow, dialog, shell } from "electron";
import { NODE_DEFAULT_PORT } from "@sharetify/shared";
import { buildMenu } from "./menu.js";
import { startNodeServer } from "./server/index.js";
import { loadWindowState, rememberWindowState } from "./window-state.js";

/**
 * デスクトップアプリ。
 *
 * ここでの役割はふたつ。
 *   1. 画面を出す
 *   2. node サーバーを常駐させ、同じ持ち主のスマホから使えるようにする
 *
 * 2 が本体と言ってよく、アプリを閉じてもサーバーは残す。
 * 落とすと外出先のスマホからダウンロード済みしか鳴らせなくなる。
 */

const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * 同梱した画面の置き場。
 *
 * 配って回るものには画面も入れておく。開発中はここに無いので、
 * 別に立てた配信役から取る。
 */
const BUNDLED_WEB = join(HERE, "web");
const WEB_DEV_URL = process.env.SHARETIFY_WEB_URL ?? "http://localhost:5273";

let window: BrowserWindow | null = null;

async function createWindow(url: string): Promise<void> {
  // 前に閉じたときの姿で開く。毎回置き直さずに済む。
  const state = await loadWindowState();

  window = new BrowserWindow({
    width: state.width,
    height: state.height,
    ...(state.x !== undefined && state.y !== undefined ? { x: state.x, y: state.y } : {}),
    minWidth: 860,
    minHeight: 560,
    backgroundColor: "#000000",
    // 枠は自前で持つ。掴んで動かせる場所は画面側で用意してある。
    titleBarStyle: "hiddenInset",
    /*
     * 閉じる・しまう・広げるの丸いボタンを少し下げる。
     * 既定の位置だと、左の並びのいちばん上の見出しに重なる。
     */
    trafficLightPosition: { x: 14, y: 18 },
    // 中身が出そろう前に見せると、暗い枠が一瞬ちらつく。
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (state.maximized) window.maximize();
  rememberWindowState(window);

  window.once("ready-to-show", () => window?.show());

  await window.loadURL(url);
  window.on("closed", () => {
    window = null;
  });

  // 外へ出る入口 (歌詞の探し先など) は、既定の閲覧環境に渡す。
  window.webContents.setWindowOpenHandler(({ url: target }) => {
    void shell.openExternal(target);
    return { action: "deny" };
  });
}

/*
 * 名乗る名前を先に決める。
 *
 * 包む前は入れ物の既定の名前 (Electron) が品書きに出てしまう。
 * 包んだあとは正しく出るが、開発中も同じ名前で確かめられるほうがよい。
 */
app.setName("Sharetify");

app.whenReady().then(async () => {
  const port = Number(process.env.PORT ?? NODE_DEFAULT_PORT);
  const bundled = existsSync(join(BUNDLED_WEB, "index.html"));
  const url = bundled ? `http://127.0.0.1:${port}/` : WEB_DEV_URL;

  buildMenu(() => window);

  try {
    await startNodeServer(port, bundled ? BUNDLED_WEB : undefined);
    await createWindow(url);
  } catch (error) {
    /*
     * 立ち上がらなかったことを黙って飲み込まない。
     * 何も出ないまま窓だけ開かない状態になると、
     * 何が起きているのか確かめる手掛かりが残らない。
     */
    console.error("[sharetify] 起動に失敗しました", error);
    dialog.showErrorBox(
      "起動できませんでした",
      error instanceof Error ? `${error.message}\n\n${error.stack ?? ""}` : String(error),
    );
    app.quit();
    return;
  }

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) void createWindow(url);
  });
});

// ウィンドウを閉じてもサーバーを止めない。スマホ側の再生を切らさないため。
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") return;
});
