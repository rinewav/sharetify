import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow, dialog, ipcMain, session, shell } from "electron";
import { NODE_DEFAULT_PORT } from "@sharetify/shared";
import { buildMenu } from "./menu.js";
import { startNodeServer } from "./server/index.js";
import { applyStartupSettings, startedHidden } from "./startup.js";
import {
  attachThumbar,
  detachThumbar,
  updateThumbar,
  type MediaCommand,
  type PlaybackState,
} from "./thumbar.js";
import { createTray, destroyTray } from "./tray.js";
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
 * 本当に終わらせにきているか。
 *
 * 窓の「閉じる」は、この仕組みでは終わりを意味しない。
 * 上端の入口から終わらせたときだけ、素通りさせる。
 */
let quitting = false;

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

/*
 * マイクとカメラは断る。
 *
 * このアプリは音を鳴らすだけで、録るほうには一切触れない。
 * ただし内側の描画まわりは、鳴らし先を数えるついでに録り口も覗きにいく。
 * すると macOS が「マイクを使ってよいか」と持ち主に訊ねてしまう。
 *
 * 訊ねる筋のないものなので、要求が上がってくる前にここで断つ。
 * 断る先は録り書き (media) まわりだけで、それ以外の求めは今までどおり通す。
 */
const CAPTURE_PERMISSIONS = new Set(["media", "audioCapture", "videoCapture", "display-capture"]);

function refuseCapturePermissions(): void {
  const target = session.defaultSession;

  target.setPermissionRequestHandler((_contents, permission, callback) => {
    callback(!CAPTURE_PERMISSIONS.has(permission));
  });

  /*
   * 求めを出さずに「使えるか」だけ確かめにくる道もある。
   * そちらでも使えないと答えておかないと、覗きにいく処理が走ってしまう。
   */
  target.setPermissionCheckHandler((_contents, permission) => !CAPTURE_PERMISSIONS.has(permission));

  // 機器そのものを名指しで掴みにくる道も塞ぐ。
  target.setDevicePermissionHandler(() => false);
}

/**
 * タスクバーで押されたことを画面に伝える。
 *
 * 実際に鳴らしているのは画面の側なので、こちらは合図を運ぶだけ。
 * 窓が無ければ何も起きない。押せる場所もそのとき出ていない。
 */
function sendMediaCommand(command: MediaCommand): void {
  window?.webContents.send("sharetify:command", command);
}

/**
 * 画面からの知らせを受けて、ボタンの見た目を合わせる。
 *
 * 流れているのに「再生」の絵のままだと、押しても止まらないように見える。
 * 受け取る先はこの窓だけに絞る。ほかから同じ知らせが来る筋はない。
 */
function listenForPlaybackState(): void {
  ipcMain.on("sharetify:playback", (event, state: unknown) => {
    if (!window || event.sender !== window.webContents) return;
    if (typeof state !== "object" || state === null) return;

    const { playing, controllable, hasTrack } = state as Partial<PlaybackState>;
    updateThumbar({
      playing: playing === true,
      controllable: controllable !== false,
      hasTrack: hasTrack === true,
    });
  });
}

async function createWindow(url: string, show = true): Promise<void> {
  /*
   * 既にあるなら、新しく作らずそれを前に出す。
   *
   * 上端の入口から何度押しても窓が増えないようにする。
   */
  if (window) {
    if (window.isMinimized()) window.restore();
    window.show();
    window.focus();
    return;
  }

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
     * Windows と Linux では、メニューが窓の中に帯として出る。
     * 押す理由のないものが場所を取るので出さない。
     * (メニューそのものも menu.ts 側で組み立てないようにしてある)
     */
    autoHideMenuBar: true,
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
      /*
       * 画面との細い通し口。
       * タスクバーのボタンを押した合図を運び、鳴っているかどうかを受け取る。
       */
      preload: join(HERE, "preload.cjs"),
    },
  });

  /*
   * タスクバーの絵に指を乗せたときの操作盤を付ける。
   * (Windows 以外では何も起きない)
   */
  attachThumbar(window, sendMediaCommand);

  if (state.maximized) window.maximize();
  rememberWindowState(window);

  /*
   * 静かに起きる場面では、組み上がっても見せない。
   *
   * 窓は作っておく。次に呼ばれたとき、読み込みを待たずにすぐ出せる。
   */
  window.once("ready-to-show", () => {
    if (show) window?.show();
  });

  await window.loadURL(url);

  /*
   * 閉じるを押されても、裏に隠すだけにする。
   *
   * このアプリの役目は、スマホから頼まれた曲を渡すこと。
   * 窓を閉じたのは「見えなくてよい」であって「もう要らない」ではない。
   * 消してしまうと、外出先から自分の PC を呼べなくなる。
   *
   * 作り直さず取っておくのは、次に呼ばれたとき待たせないため。
   * 終わらせたいときは上端の入口から。そちらは素通りさせる。
   */
  window.on("close", (event) => {
    if (quitting) return;
    event.preventDefault();
    window?.hide();
  });

  window.on("closed", () => {
    window = null;
    detachThumbar();
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
 * 録り口の機器を掴みにいかせない。
 *
 * 内側の描画まわりは、繋がっている音の機器を数え上げるとき、
 * 鳴らす側だけでなく録る側も一緒に見にいく。
 * macOS はその一覧を作る段で持ち主に許可を訊ねるので、
 * 曲を流すたび、何度も同じ窓が出てしまう。
 *
 * ここで作り物の機器に差し替えておくと、
 * 数え上げは作り物のほうで済み、本物の録り口には触れなくなる。
 * 鳴らす側は別の道を通るので、再生には影響しない。
 *
 * 立ち上がりきる前に伝える必要があるので、whenReady より先に置く。
 */
app.commandLine.appendSwitch("use-fake-device-for-media-stream");

/*
 * 二つ目は立ち上げない。
 *
 * 同じパソコンで二重に動かすと、待ち受ける場所を取り合って落ちる。
 * 二つ目を開こうとしたら、既にある窓を前に出すだけにする。
 */
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  /*
   * 二つ目を開こうとしたら、既にあるものを前に出す。
   *
   * 裏で待っているだけで窓が無いこともある。そのときは開き直す。
   * 何も起きないと、動いていないと思われて何度も押される。
   */
  app.on("second-instance", () => {
    void createWindow(windowUrl);
  });

  app.whenReady().then(async () => {
    const wanted = Number(process.env.PORT ?? NODE_DEFAULT_PORT);
    const bundled = existsSync(join(BUNDLED_WEB, "index.html"));

    refuseCapturePermissions();
    listenForPlaybackState();
    buildMenu(() => window);

    /*
     * 名簿の側と、覚えている内容を合わせ直す。
     * 人の手で外されていることもあるので、起きるたびに見る。
     */
    await applyStartupSettings();

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

      /*
       * 上端の入口を先に出す。
       *
       * 静かに起きた場面では、これが唯一の目印になる。
       * 窓より先に置いておかないと、動いているのに何も見えない時間ができる。
       */
      await createTray({
        onOpen: () => void createWindow(windowUrl),
        onQuit: () => {
          quitting = true;
          app.quit();
        },
      });

      await createWindow(windowUrl, !startedHidden());
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

/*
 * 窓が無くなっても終わらせない。
 *
 * 待ち受ける役目は窓と関係なく続く。ここで何もしないことが、
 * そのまま「裏で動き続ける」という意味になる。
 * (Electron は、この耳を付けておくと既定の後始末をしない)
 */
app.on("window-all-closed", () => undefined);

/** 上端の入口は自分で片付ける。残すと絵だけが居座る。 */
app.on("before-quit", () => {
  quitting = true;
  destroyTray();
});
