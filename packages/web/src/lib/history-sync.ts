import { canReachNode, nodeClearHistory, nodeIdentity, nodeMergeHistory } from "./node-client.js";
import { peerClient } from "./peer-client.js";
import {
  absorbHistory,
  allHistory,
  forgetCursors,
  onHistoryChange,
  rememberCursor,
  syncCursor,
} from "./play-history.js";

/**
 * 聴いた跡を、自分の PC と分け合う。
 *
 * 端末は替わるし、覚えているものを消すこともある。
 * PC のほうが長生きするので、そちらを寄せ集める場所にして、
 * 繋がったときに両方の持ち物を突き合わせる。
 * 電話で聴いたものが PC のおすすめに効き、その逆も効くようになる。
 *
 * 行き来するのはこの端末と自分の PC の間だけ。中央サーバーは通らない。
 * 誰が何を聴いたかを外に出さないための線引きで、
 * ここが崩れると設計の前提が変わる。
 */

/** 一度に預ける上限。全部を一度に渡すと、繋いだ直後に詰まる。 */
const BATCH = 500;

/** 聴き終えてから預けるまでの間。続けて聴くぶんをまとめる。 */
const SETTLE_MS = 5000;

let syncing = false;
let pendingTimer: ReturnType<typeof setTimeout> | null = null;
/** この繋がりで、どこまで預けたか。ここより新しいものだけを次に渡す。 */
let sentUpTo = 0;
let started = false;

/**
 * いま突き合わせる。
 *
 * 二重に走らせない。走っている最中にもう一度呼ばれても、
 * 一度目が持っていくので、待つ必要はない。
 */
export async function syncHistory(): Promise<void> {
  if (syncing || !canReachNode()) return;
  const peer = nodeIdentity();
  if (!peer) return;

  syncing = true;
  try {
    /*
     * 預けるのは、まだ預けていないぶんだけ。
     * 初回は全部だが、多いと一度で運びきれないので新しいほうから刻む。
     */
    const unsent = allHistory()
      .filter((entry) => entry.playedAt > sentUpTo)
      .slice(0, BATCH);

    const reply = await nodeMergeHistory(unsent, syncCursor(peer));

    if (unsent.length > 0) sentUpTo = Math.max(sentUpTo, unsent[0]!.playedAt);
    absorbHistory(reply.entries);
    rememberCursor(peer, reply.cursor);

    /*
     * 刻んだぶんが残っているなら続ける。
     * 一度で終わらせなくてよいが、続けたほうが早くそろう。
     */
    if (unsent.length === BATCH) {
      syncing = false;
      await syncHistory();
      return;
    }
  } catch {
    // 繋がりが切れただけのこともある。次に繋がったときにやり直す。
  } finally {
    syncing = false;
  }
}

/** 続けて聴くぶんをまとめてから預ける。 */
function syncSoon(): void {
  if (pendingTimer) return;
  pendingTimer = setTimeout(() => {
    pendingTimer = null;
    void syncHistory();
  }, SETTLE_MS);
}

/**
 * 分け合いを始める。
 *
 * 繋がったときと、新しく聴いたときに突き合わせる。
 * 画面のどこからでも呼べるよう、入口は一つにして、二度目は何もしない。
 */
export function startHistorySync(): void {
  if (started) return;
  started = true;

  peerClient.onStatus((status) => {
    if (status !== "connected") return;
    /*
     * 繋ぎ直したら、預けた所を戻す。
     * 相手が別の PC に変わっていることもあるので、渡し直す。
     * どこまで受け取ったかの印は相手ごとに覚えてあるので、
     * 同じ相手なら運び直しにはならない。
     */
    sentUpTo = 0;
    void syncHistory();
  });

  onHistoryChange(() => {
    if (canReachNode()) syncSoon();
  });

  void syncHistory();
}

/** 端末で捨てたぶんを、PC 側にも合わせる。 */
export async function clearSharedHistory(): Promise<void> {
  sentUpTo = 0;
  forgetCursors();
  if (!canReachNode()) return;
  try {
    const reply = await nodeClearHistory();
    const peer = nodeIdentity();
    // 消したあとの印を持っておく。持たないと、消す前のぶんが降りてくる。
    if (peer) rememberCursor(peer, reply.cursor);
  } catch {
    // 届かなければ、この端末のぶんだけ消える。
  }
}
