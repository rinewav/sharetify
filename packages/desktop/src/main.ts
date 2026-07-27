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
/** 窓を開き直すときの行き先。立てたあとに決まる。 */
let windowUrl = WEB_DEV_URL;

/**
 * その場所で既に動いているものが、画面まで配れるかどうか。
 *
 * 二つ目を立ち上げたときや、開発中のものが残っているとき、
 * そのまま待ち受けようとすると場所の取り合いで落ちる。
 * 相手が画面まで配れるなら、立てずにそれを開けば済む。
 *
 * 大事なのは「仲間かどうか」ではなく「画面を配れるかどうか」。
 * 開発中のものは仕組みだけを持っていて画面を配らないので、
 * それを開くと何も出ない。
 */
async function findUsableServer(port: number): Promise<boolean> {
  try {
    const health = await fetch(`http://127.0.0.1:${port}/api/health`, {
      signal: AbortSignal.timeout(1500),
    });
    if (!health.ok) return false;
    const body = (await health.json()) as { ok?: boolean; version?: string };
    if (body.ok !== true || typeof body.version !== "string") return false;

    // 画面まで配れるか確かめる。配れないなら、そこを開いても何も出ない。
    const page = await fetch(`http://127.0.0.1:${port}/`, {
      signal: AbortSignal.timeout(1500),
    });
    return page.ok && (page.headers.get("content-type") ?? "").includes("html");
  } catch {
    return false;
  }
}

/**
 * 空いている場所を探す。
 *
 * 決まった場所が既に埋まっていて、そこが使えないときに使う。
 * 埋まったまま待ち受けようとすれば落ちるだけなので、少しずらして試す。
 */
async function findFreePort(from: number, attempts = 20): Promise<number> {
  const { createServer } = await import("node:net");

  for (let port = from; port < from + attempts; port += 1) {
    /*
     * 実際に待ち受けるのと同じ形で試す。
     *
     * 特定の宛先だけを見て確かめると、全ての宛先で待ち受けている相手を
     * 見落とす。空いていると判じた場所で立てようとして落ちる。
     */
    const free = await new Promise<boolean>((resolve) => {
      const probe = createServer();
      probe.once("error", () => resolve(false));
      probe.once("listening", () => probe.close(() => resolve(true)));
      probe.listen(port);
    });
    if (free) return port;
  }
  throw new Error(`${from} から ${attempts} 個ぶん探しましたが、空きがありません`);
}

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

/*
 * 二つ目は立ち上げない。
 *
 * 同じ機械で二重に動かすと、待ち受ける場所を取り合って落ちる。
 * 二つ目を開こうとしたら、既にある窓を前に出すだけにする。
 */
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!window) return;
    if (window.isMinimized()) window.restore();
    window.focus();
  });

  app.whenReady().then(async () => {
    const wanted = Number(process.env.PORT ?? NODE_DEFAULT_PORT);
    const bundled = existsSync(join(BUNDLED_WEB, "index.html"));

    buildMenu(() => window);

    try {
      /*
       * 既に画面まで配れるものが待ち受けているなら、重ねて立てない。
       * 二つ目を開いたときに、これで助かる。
       */
      let port = wanted;
      const usable = await findUsableServer(wanted);

      if (usable) {
        console.log(`[sharetify] ${port} で既に動いているものを使います`);
      } else {
        /*
         * 使えないものが居座っているなら、場所をずらして自分で立てる。
         * 開発中のものは仕組みだけを持っていて画面を配らないので、
         * そこに相乗りすると何も出ない。
         */
        port = await findFreePort(wanted);
        if (port !== wanted) {
          console.log(`[sharetify] ${wanted} は使えないので ${port} で立てます`);
        }
        await startNodeServer(port, bundled ? BUNDLED_WEB : undefined);
      }

      windowUrl = bundled ? `http://127.0.0.1:${port}/` : WEB_DEV_URL;
      await createWindow(windowUrl);
    } catch (error) {
      /*
       * 立ち上がらなかったことを黙って飲み込まない。
       * 何も出ないまま窓だけ開かない状態になると、
       * 何が起きているのか確かめる手掛かりが残らない。
       */
      console.error("[sharetify] 起動に失敗しました", error);
      dialog.showErrorBox("起動できませんでした", describeStartupError(error, wanted));
      app.quit();
      return;
    }

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) void createWindow(windowUrl);
    });
  });
}

/** 何が起きたのかを、読んで分かる言葉にする。 */
function describeStartupError(error: unknown, port: number): string {
  const code = (error as { code?: string } | null)?.code;

  if (code === "EADDRINUSE") {
    return [
      `${port} 番の口を、別のものが既に使っています。`,
      "",
      "Sharetify がもう一つ動いていないか確かめてください。",
      "動いていない場合は、その口を使っているものを閉じてから開き直してください。",
    ].join("\n");
  }
  if (code === "EACCES") {
    return `${port} 番の口を使う許しがありません。`;
  }

  const message = error instanceof Error ? error.message : String(error);
  return `${message}\n\n閉じてから、もう一度開いてみてください。`;
}

// ウィンドウを閉じてもサーバーを止めない。スマホ側の再生を切らさないため。
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") return;
});
