import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { app } from "electron";

/**
 * 立ち上がり方の設定。
 *
 * このアプリの本体は、窓ではなく常駐する側にある。
 * スマホから曲を頼まれるのはこの PC で、窓を閉じている間も
 * その役目は続いていないといけない。
 *
 * そこで、はじめから次の二つを効かせておく。
 *   1. パソコンを立ち上げたら、一緒に起き出す
 *   2. 窓を閉じても、裏で待ち続ける
 *
 * どちらも気が変わったら止められる。止めたことは覚えておく。
 */

const SETTINGS_PATH = join(homedir(), ".sharetify", "startup.json");

/** 窓を出さずに起き出すときの目印。ログイン時の自動起動に付ける。 */
export const HIDDEN_FLAG = "--sharetify-hidden";

export interface StartupSettings {
  /** パソコンと一緒に起き出すか。 */
  openAtLogin: boolean;
}

const DEFAULTS: StartupSettings = { openAtLogin: true };

let cached: StartupSettings | null = null;

export async function loadStartupSettings(): Promise<StartupSettings> {
  if (cached) return cached;

  try {
    const saved = JSON.parse(await readFile(SETTINGS_PATH, "utf8")) as Partial<StartupSettings>;
    cached = { openAtLogin: saved.openAtLogin !== false };
  } catch {
    // まだ何も決めていない。はじめの構えで動く。
    cached = { ...DEFAULTS };
  }

  return cached;
}

async function save(settings: StartupSettings): Promise<void> {
  cached = settings;
  await mkdir(dirname(SETTINGS_PATH), { recursive: true });
  await writeFile(SETTINGS_PATH, JSON.stringify(settings, null, 2), "utf8");
}

/**
 * 覚えている内容を、実際の仕掛けに映す。
 *
 * 覚えているだけでは何も起きない。OS 側の名簿に載せて初めて効く。
 * 逆に、名簿の側が人の手で外されていることもある。
 * 起き出すたびに合わせ直しておけば、食い違ったままにならない。
 */
export async function applyStartupSettings(): Promise<void> {
  const settings = await loadStartupSettings();
  setLoginItem(settings.openAtLogin);
}

export async function setOpenAtLogin(openAtLogin: boolean): Promise<StartupSettings> {
  const settings = { ...(await loadStartupSettings()), openAtLogin };
  setLoginItem(openAtLogin);
  await save(settings);
  return settings;
}

function setLoginItem(openAtLogin: boolean): void {
  /*
   * 開発中に名簿へ載せない。
   *
   * 包む前の実体は入れ物 (electron) 自身を指しているので、
   * 載せるとパソコンを立ち上げるたびに開発用のものが起きてしまう。
   */
  if (!app.isPackaged) return;

  app.setLoginItemSettings({
    openAtLogin,
    /*
     * 窓は出さずに起きる。
     *
     * 立ち上げるたび窓が前に出ると、他の作業の邪魔になる。
     * 待ち受ける役目は窓が無くても果たせるので、静かに始める。
     * macOS は専用の指定があり、Windows には引数で伝える。
     */
    openAsHidden: true,
    args: [HIDDEN_FLAG],
  });
}

/** 窓を出さずに始める場面か。 */
export function startedHidden(): boolean {
  if (process.argv.includes(HIDDEN_FLAG)) return true;

  // macOS は専用の指定で起こされる。引数には出てこない。
  return app.getLoginItemSettings().wasOpenedAsHidden === true;
}
