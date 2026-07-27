import { canReachNode, reportPresence } from "./node-client.js";
import { usePlayer } from "./player-store.js";

/**
 * いま聴いているものを Discord に伝える。
 *
 * 実際に Discord と話すのは自分の PC の側で、ここはその橋渡し。
 * 端末で鳴らしていても、繋がっていれば PC 経由で表示に出る。
 *
 * 使うかどうかは PC の設定で決める。使わない設定なら、
 * 送っても PC 側が捨てるので、こちらでは気にしない。
 */

/** 何も変わっていなくても送り直す間隔。表示が消えるのを防ぐ。 */
const HEARTBEAT_MS = 60_000;

let started = false;
let lastKey = "";
let lastSentAt = 0;

function send(): void {
  if (!canReachNode()) return;

  const state = usePlayer.getState();
  const track = state.current();

  /*
   * 曲と再生状態が同じなら送らない。
   * 再生位置は絶えず動くが、Discord に出るのは終わる時刻なので、
   * 同じ曲を同じ状態で流している限り、送り直す意味がない。
   *
   * ただし、まったく送らないでいると表示が消える。
   * 変わらないままでも、たまに送り直す。
   */
  const key = track ? `${track.id}|${state.playing}` : "";
  const stale = Date.now() - lastSentAt > HEARTBEAT_MS;
  if (key === lastKey && !stale) return;

  lastKey = key;
  lastSentAt = Date.now();

  void reportPresence(
    track
      ? {
          title: track.title,
          artist: track.artist,
          ...(track.artworkUrl ? { artworkUrl: track.artworkUrl } : {}),
          ...(track.durationMs ? { durationMs: track.durationMs } : {}),
        }
      : null,
    state.positionMs,
    !state.playing,
  ).catch(() => {
    // 繋がっていないだけのことが多い。次の機会に送り直す。
    lastKey = "";
  });
}

/**
 * 伝え始める。
 *
 * 画面のどこからでも呼べるよう、入口は一つにして、二度目は何もしない。
 */
export function startDiscordPresence(): void {
  if (started) return;
  started = true;

  usePlayer.subscribe(send);
  setInterval(send, 15_000);
  send();
}
