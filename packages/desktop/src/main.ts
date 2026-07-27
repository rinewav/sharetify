import { app, BrowserWindow } from "electron";
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

const WEB_DEV_URL = process.env.SHARETIFY_WEB_URL ?? "http://localhost:5273";

let window: BrowserWindow | null = null;

async function createWindow(): Promise<void> {
  window = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 600,
    backgroundColor: "#0a0a0c",
    titleBarStyle: "hiddenInset",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  await window.loadURL(WEB_DEV_URL);
  window.on("closed", () => {
    window = null;
  });
}

app.whenReady().then(async () => {
  await startNodeServer(Number(process.env.PORT ?? NODE_DEFAULT_PORT));
  await createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) void createWindow();
  });
});

// ウィンドウを閉じてもサーバーを止めない。スマホ側の再生を切らさないため。
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") return;
});
