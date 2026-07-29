import { canControl, usePlayer } from "./player-store.js";

/**
 * 入れ物の側にある操作盤と、画面をつなぐ。
 *
 * Windows では、タスクバーの絵に指を乗せると小さなボタンが出る。
 * そこが押されたことは入れ物にしか届かず、
 * 逆に、いま鳴っているかどうかは画面にしか無い。
 * その行き違いをここで埋める。
 *
 * 閲覧環境で開いたときは通し口そのものが無いので、何もせず戻る。
 */

interface DesktopBridge {
  reportPlayback: (state: {
    playing: boolean;
    controllable: boolean;
    hasTrack: boolean;
  }) => void;
  onCommand: (handler: (command: "prev" | "toggle" | "next") => void) => () => void;
}

declare global {
  interface Window {
    sharetifyDesktop?: DesktopBridge;
  }
}

export function connectDesktopMedia(): void {
  const bridge = typeof window === "undefined" ? undefined : window.sharetifyDesktop;
  if (!bridge) return;

  bridge.onCommand((command) => {
    const player = usePlayer.getState();
    // ほかの人の場に相乗りしている間は、こちらから触らせない。
    if (!canControl(player)) return;

    if (command === "prev") player.prev();
    else if (command === "next") player.next();
    else player.toggle();
  });

  /*
   * 様子が変わるたびに伝える。
   *
   * 入れ物の側は同じ内容なら描き直さないので、
   * ここでは細かく間引かず、そのまま渡してしまってよい。
   */
  const report = (state: ReturnType<typeof usePlayer.getState>) => {
    bridge.reportPlayback({
      playing: state.playing,
      controllable: canControl(state),
      hasTrack: state.queue.length > 0,
    });
  };

  report(usePlayer.getState());
  usePlayer.subscribe(report);
}
