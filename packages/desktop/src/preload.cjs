const { contextBridge, ipcRenderer } = require("electron");

/**
 * 画面と入れ物のあいだの、細い通し口。
 *
 * 画面そのものは、入れ物の中でも閲覧環境でも同じものが動く。
 * だから画面側から Electron を直に触らせるわけにはいかない。
 * ここで渡すのは「いま何が鳴っているかを伝える」「押されたら知らせる」の
 * 二つだけで、それ以外の道は開けない。
 *
 * Windows のタスクバーに出す小さなボタンは、入れ物の側にしか置けない。
 * 押された合図を画面まで運ぶ道が要る。
 *
 * (このファイルだけは、包む前の姿のまま dist に配られる。
 *  読み込む側が古い書き方しか受け付けないので .cjs のままにしてある)
 */

contextBridge.exposeInMainWorld("sharetifyDesktop", {
  /** いま鳴っているかどうかを伝える。ボタンの絵を切り替えるのに使う。 */
  reportPlayback(state) {
    ipcRenderer.send("sharetify:playback", state);
  },

  /** タスクバーのボタンが押されたら呼ばれる。 */
  onCommand(handler) {
    const listener = (_event, command) => handler(command);
    ipcRenderer.on("sharetify:command", listener);
    return () => ipcRenderer.off("sharetify:command", listener);
  },
});
