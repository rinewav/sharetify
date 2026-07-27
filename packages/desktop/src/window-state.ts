import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import type { BrowserWindow } from "electron";

/**
 * 窓の大きさと置き場所を覚えておく。
 *
 * 開くたびに真ん中の既定寸法に戻ると、毎回置き直すことになる。
 * 前に閉じたときの姿で開くのが当たり前の振る舞い。
 */

const STATE_PATH = join(homedir(), ".sharetify", "window.json");

interface WindowState {
  width: number;
  height: number;
  x?: number;
  y?: number;
  maximized: boolean;
}

const DEFAULTS: WindowState = { width: 1280, height: 800, maximized: false };

export async function loadWindowState(): Promise<WindowState> {
  try {
    const saved = JSON.parse(await readFile(STATE_PATH, "utf8")) as Partial<WindowState>;
    return {
      // 覚えた値が壊れていても開けなくならないよう、形を確かめてから使う。
      width: numberOr(saved.width, DEFAULTS.width, 640),
      height: numberOr(saved.height, DEFAULTS.height, 480),
      ...(typeof saved.x === "number" ? { x: saved.x } : {}),
      ...(typeof saved.y === "number" ? { y: saved.y } : {}),
      maximized: saved.maximized === true,
    };
  } catch {
    return { ...DEFAULTS };
  }
}

function numberOr(value: unknown, fallback: number, min: number): number {
  return typeof value === "number" && Number.isFinite(value) && value >= min ? value : fallback;
}

/**
 * 動かすたびに書かず、落ち着いてから書く。
 * 掴んで動かしている間じゅう書き込むと、無駄に触りにいくことになる。
 */
export function rememberWindowState(window: BrowserWindow): void {
  let timer: ReturnType<typeof setTimeout> | null = null;

  const save = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      void persist(window);
    }, 500);
  };

  window.on("resize", save);
  window.on("move", save);
  window.on("maximize", save);
  window.on("unmaximize", save);
  // 閉じる時は待たずに書く。待っていると間に合わない。
  window.on("close", () => void persist(window));
}

async function persist(window: BrowserWindow): Promise<void> {
  if (window.isDestroyed()) return;
  try {
    const maximized = window.isMaximized();
    // 広げている間の寸法を覚えると、戻したときに画面いっぱいのままになる。
    const bounds = maximized ? window.getNormalBounds() : window.getBounds();
    const state: WindowState = {
      width: bounds.width,
      height: bounds.height,
      x: bounds.x,
      y: bounds.y,
      maximized,
    };
    await mkdir(dirname(STATE_PATH), { recursive: true });
    await writeFile(STATE_PATH, JSON.stringify(state, null, 2), "utf8");
  } catch {
    // 覚えられなくても使えなくはならない。次に開けば既定の姿で出る。
  }
}
