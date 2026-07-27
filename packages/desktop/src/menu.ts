import { app, Menu, shell, type BrowserWindow, type MenuItemConstructorOptions } from "electron";

/**
 * 上に出す品書き。
 *
 * 何も用意しないと、既定の英語の品書きがそのまま出る。
 * 中身も開発者向けのものが並んでいて、配って回すものには合わない。
 */

const isMac = process.platform === "darwin";

export function buildMenu(getWindow: () => BrowserWindow | null): void {
  const template: MenuItemConstructorOptions[] = [
    ...(isMac
      ? ([
          {
            label: app.name,
            submenu: [
              { role: "about", label: `${app.name} について` },
              { type: "separator" },
              { role: "services", label: "サービス" },
              { type: "separator" },
              { role: "hide", label: `${app.name} を隠す` },
              { role: "hideOthers", label: "ほかを隠す" },
              { role: "unhide", label: "すべて表示" },
              { type: "separator" },
              { role: "quit", label: `${app.name} を終了` },
            ],
          },
        ] as MenuItemConstructorOptions[])
      : []),
    {
      label: "編集",
      submenu: [
        { role: "undo", label: "取り消す" },
        { role: "redo", label: "やり直す" },
        { type: "separator" },
        { role: "cut", label: "切り取る" },
        { role: "copy", label: "コピー" },
        { role: "paste", label: "貼り付け" },
        { role: "selectAll", label: "すべて選ぶ" },
      ],
    },
    {
      label: "表示",
      submenu: [
        { role: "reload", label: "読み込み直す" },
        { role: "togglefullscreen", label: "全画面にする" },
        { type: "separator" },
        { role: "resetZoom", label: "実寸に戻す" },
        { role: "zoomIn", label: "大きくする" },
        { role: "zoomOut", label: "小さくする" },
        { type: "separator" },
        // 不具合を調べるときだけ使う。ふだんは目に入らなくてよい。
        { role: "toggleDevTools", label: "開発者ツール", visible: !app.isPackaged },
      ],
    },
    {
      label: "ウインドウ",
      submenu: isMac
        ? [
            { role: "minimize", label: "しまう" },
            { role: "zoom", label: "拡大 / 縮小" },
            { type: "separator" },
            { role: "front", label: "すべて前面に" },
          ]
        : [
            { role: "minimize", label: "しまう" },
            { role: "close", label: "閉じる" },
          ],
    },
    {
      label: "ヘルプ",
      submenu: [
        {
          label: "自分の PC につなぐ",
          click: () => {
            // 画面側の入口を開く。合言葉を入れる所。
            getWindow()?.webContents.send("sharetify:open-pairing");
          },
        },
        { type: "separator" },
        {
          label: "置いてある場所を開く",
          click: () => void shell.openPath(app.getPath("home") + "/.sharetify"),
        },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
