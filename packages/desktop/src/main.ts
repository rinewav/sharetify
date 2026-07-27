import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow, dialog, shell } from "electron";
import { NODE_DEFAULT_PORT } from "@sharetify/shared";
import { startNodeServer } from "./server/index.js";

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
  window = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 600,
    backgroundColor: "#000000",
    titleBarStyle: "hiddenInset",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

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

app.whenReady().then(async () => {
  const port = Number(process.env.PORT ?? NODE_DEFAULT_PORT);
  const bundled = existsSync(join(BUNDLED_WEB, "index.html"));
  const url = bundled ? `http://127.0.0.1:${port}/` : WEB_DEV_URL;

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
