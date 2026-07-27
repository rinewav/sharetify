import { create } from "zustand";
import {
  computeClockOffset,
  expectedPositionMs,
  SYNC_DRIFT_NUDGE_MS,
  SYNC_DRIFT_SEEK_MS,
  type ClientMessage,
  type ListeningSession,
  type ReadinessEntry,
  type ServerMessage,
  type SessionControl,
} from "@musicshare/shared";
import { hubCreateSession, hubListSessions, storedToken } from "./hub-client.js";
import { useLibrary } from "./library-store.js";
import { attachSessionBridge, usePlayer } from "./player-store.js";

/**
 * 同時リスニング。
 *
 * 音は誰からも送られてこない。参加者はそれぞれ自分の node から同じ曲を取得し、
 * hub が配る「いつ時点で何秒の位置か」に自分を合わせにいく。
 * だから hub の帯域は毎秒数十バイトで済み、中継も要らない。
 */

export interface Participant {
  /** 繋がりごとの識別子。同じ人が別の端末から入ることがある。 */
  participantId: string;
  userId: string;
  displayName: string;
  ready: boolean;
  reason?: string;
  isHost: boolean;
}

interface SessionState {
  /** 中央との経路が開いているか。参加しているかとは別。 */
  connected: boolean;
  /**
   * いま一緒に聴いているか。
   * 経路が開いているだけでは参加したことにならないので、分けて持つ。
   */
  inSession: boolean;
  session: ListeningSession | null;
  participants: Participant[];
  /** この端末が場を進めているか。中央が繋がりごとに教えてくれる。 */
  isHost: boolean;
  /** hub の時計と自分の時計のズレ (ミリ秒)。 */
  clockOffsetMs: number;
  roundTripMs: number;
  /** 直近に測った同期のズレ。UI に出して健全性を見せる。 */
  driftMs: number;
  myUserId: string | null;

  connect: (token: string, userId: string) => void;
  disconnect: () => void;
  joinSession: (sessionId: string) => void;
  leaveSession: () => void;
  control: (action: SessionControl) => void;
  /** ホストの操作を場に流す。参加していないときは何もしない。 */
  broadcast: (action: SessionControl) => void;
  reportReadiness: (trackId: string, ready: boolean, reason?: string) => void;
  /** 集まりの中で始める。既に誰かが始めていればそこへ入る。 */
  startForGroup: (groupId: string) => Promise<void>;
}

let socket: WebSocket | null = null;
let pingTimer: ReturnType<typeof setInterval> | null = null;
let driftTimer: ReturnType<typeof setInterval> | null = null;

/**
 * いま動かしているのが「相手に合わせるため」かどうか。
 *
 * 追随のための操作をそのまま送り返すと、往復し続けて止まらなくなる。
 * この間だけ送信を止める。
 */
let applyingRemote = false;

function applyRemotely(action: () => void): void {
  applyingRemote = true;
  try {
    action();
  } finally {
    applyingRemote = false;
  }
}

/*
 * 再生の操作を場へ流す口を、こちら側から差し込む。
 * 再生を司る側は「場」を知らないままでいられる。
 */
attachSessionBridge((action) => useSession.getState().broadcast(action));

export const useSession = create<SessionState>((set, get) => ({
  connected: false,
  inSession: false,
  isHost: false,
  session: null,
  participants: [],
  clockOffsetMs: 0,
  roundTripMs: 0,
  driftMs: 0,
  myUserId: null,

  connect: (token, userId) => {
    get().disconnect();

    // 中央へは同一オリジンの中継を通す。混在コンテンツで弾かれないため。
    const base = import.meta.env["VITE_HUB_BASE"] ?? "/hub-api";
    const url = new URL(`${base}/ws`, window.location.origin);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    url.searchParams.set("token", token);

    const ws = new WebSocket(url.toString());
    socket = ws;
    set({ myUserId: userId });

    ws.addEventListener("open", () => {
      set({ connected: true });
      // 起動直後に一度測り、その後は定期的に測り直して時計のズレを追う。
      sendMessage({ type: "sync:ping", clientTime: Date.now() });
      pingTimer = setInterval(() => {
        sendMessage({ type: "sync:ping", clientTime: Date.now() });
      }, 15_000);
      driftTimer = setInterval(() => reconcile(get, set), 1_000);
    });

    ws.addEventListener("message", (event) => {
      let message: ServerMessage;
      try {
        message = JSON.parse(String(event.data)) as ServerMessage;
      } catch {
        return;
      }
      handleServerMessage(message, get, set);
    });

    ws.addEventListener("close", () => {
      set({ connected: false });
      clearTimers();
    });
  },

  disconnect: () => {
    clearTimers();
    socket?.close();
    socket = null;
    set({ connected: false, inSession: false, isHost: false, session: null, participants: [] });
    usePlayer.getState().nudgeRate(1);
    usePlayer.getState().setSessionRole(false, false);
  },

  joinSession: (sessionId) => sendMessage({ type: "session:join", sessionId }),

  leaveSession: () => {
    sendMessage({ type: "session:leave" });
    // 参加をやめても経路は開けておく。すぐ入り直せるように。
    set({ inSession: false, isHost: false, session: null, participants: [], driftMs: 0 });
    // 詰めるために変えていた送りの速さを戻す。抜けたあとまで引きずらない。
    usePlayer.getState().nudgeRate(1);
    usePlayer.getState().setSessionRole(false, false);
  },

  control: (action) => sendMessage({ type: "session:control", action }),

  reportReadiness: (trackId, ready, reason) =>
    sendMessage({ type: "session:readiness", trackId, ready, reason }),

  /**
   * ホストの操作を場に流す。
   *
   * 自分で鳴らすだけでは他の人に伝わらない。逆に、追随で動いた分を
   * 送り返すと往復が止まらなくなるので、そのときは黙っている。
   */
  broadcast: (action) => {
    if (applyingRemote) return;
    const { inSession, isHost } = get();
    if (!inSession || !isHost) return;
    sendMessage({ type: "session:control", action });
  },

  startForGroup: async (groupId) => {
    const token = storedToken();
    const me = useLibrary.getState().user;
    if (!token || !me) return;

    if (!get().connected) get().connect(token, me.id);

    try {
      // 既に誰かが始めていればそこへ入る。二重に立てても意味がない。
      const existing = await hubListSessions();
      const found = existing.find((s) => s.groupId === groupId);
      const session = found ?? (await hubCreateSession(groupId));

      // 繋がりきる前に入ろうとしても届かないので、開くのを待つ。
      await waitForOpen();
      get().joinSession(session.id);
      // 新しく立てた場なら、進行役として名乗り出る。
      if (!found) sendMessage({ type: "session:claim-host" });
    } catch (error) {
      console.warn("[session]", error);
    }
  },
}));

/** 中央との経路が開くのを待つ。 */
function waitForOpen(timeoutMs = 5_000): Promise<void> {
  if (socket?.readyState === WebSocket.OPEN) return Promise.resolve();
  return new Promise((resolve) => {
    const started = Date.now();
    const timer = setInterval(() => {
      if (socket?.readyState === WebSocket.OPEN || Date.now() - started > timeoutMs) {
        clearInterval(timer);
        resolve();
      }
    }, 100);
  });
}

function sendMessage(message: ClientMessage): void {
  if (socket?.readyState !== WebSocket.OPEN) return;
  socket.send(JSON.stringify(message));
}

function clearTimers(): void {
  if (pingTimer) clearInterval(pingTimer);
  if (driftTimer) clearInterval(driftTimer);
  pingTimer = null;
  driftTimer = null;
}

type Get = () => SessionState;
type Set = (partial: Partial<SessionState>) => void;

function handleServerMessage(message: ServerMessage, get: Get, set: Set): void {
  switch (message.type) {
    case "sync:pong": {
      const { offsetMs, roundTripMs } = computeClockOffset(
        message.clientTime,
        message.serverTime,
        Date.now(),
      );
      set({ clockOffsetMs: offsetMs, roundTripMs });
      return;
    }

    case "session:state": {
      const session = message.session;
      // 進行役かどうかは中央が繋がりごとに教えてくれる。
      // 利用者で判断すると、自分の別の端末まで進行役になってしまう。
      const isHost = message.youAreHost;
      set({ session, inSession: true, isHost });

      const player = usePlayer.getState();
      player.setSessionRole(true, isHost);

      /*
       * ホストは基準そのものなので、返ってきた状態に自分を合わせない。
       * 合わせにいくと、自分の操作が折り返してきて再生が止まる。
       */
      if (isHost) return;

      // キューと曲がホスト側で変わったら追随する。
      const track = session.state.track;
      if (track) {
        const sameQueue =
          player.queue.length === session.state.queue.length &&
          player.queue.every((t, i) => t.id === session.state.queue[i]?.id);
        if (!sameQueue || player.index !== session.state.queueIndex) {
          // 追随で入れ直したことを伝えて、送り返さないようにする。
          applyRemotely(() => player.playQueue(session.state.queue, session.state.queueIndex));
        }
      }

      // 止まっているかどうかも合わせる。ホストが止めたら一緒に止まる。
      if (session.state.paused && player.playing) applyRemotely(() => player.toggle());
      else if (!session.state.paused && !player.playing && track) {
        applyRemotely(() => player.toggle());
      }

      reconcile(get, set);
      return;
    }

    case "session:readiness": {
      set({ participants: toParticipants(message.entries, get().session) });
      return;
    }

    case "session:closed": {
      set({ session: null, participants: [] });
      usePlayer.getState().nudgeRate(1);
      usePlayer.getState().setSessionRole(false, false);
      return;
    }

    case "error":
      console.warn("[session]", message.message);
      return;
  }
}

function toParticipants(
  entries: ReadinessEntry[],
  session: ListeningSession | null,
): Participant[] {
  return entries.map((entry) => ({
    participantId: entry.participantId,
    userId: entry.userId,
    displayName: entry.displayName,
    ready: entry.ready,
    reason: entry.reason,
    isHost: entry.isHost,
  }));
}

/** 詰めるときに変える送りの速さの上限。これ以上ずらすと音の高さで気付かれる。 */
const MAX_RATE_SHIFT = 0.04;

/**
 * 自分の再生位置を、hub が示す位置に寄せる。
 *
 * 小さいずれで跳ばしてはいけない。跳ぶたびに音が途切れ、
 * 途切れた分また遅れて、次の秒でまた跳ぶ、という堂々巡りになる
 * (実測で -400ms と -260ms の間を往復し続けた)。
 *
 * だから小さいずれは、送りの速さをほんの少し変えて詰める。
 * 数 % なら音の高さは変わって聞こえず、数秒かけて自然に揃う。
 * 大きく外れたときだけ、諦めて跳ぶ。
 */
function reconcile(get: Get, set: Set): void {
  const { session, clockOffsetMs, isHost } = get();
  if (!session?.state.track) return;
  // 進行役は基準。自分を自分に合わせる必要はない。
  if (isHost) return;

  const player = usePlayer.getState();
  const target = expectedPositionMs(session.state, clockOffsetMs);
  const drift = player.positionMs - target;
  set({ driftMs: drift });

  if (Math.abs(drift) >= SYNC_DRIFT_SEEK_MS) {
    player.seek(target);
    player.nudgeRate(1);
    return;
  }

  if (Math.abs(drift) < SYNC_DRIFT_NUDGE_MS) {
    // 揃っている。等速に戻す。
    player.nudgeRate(1);
    return;
  }

  /*
   * 進んでいるなら少し遅く、遅れているなら少し速く送る。
   * ずれが大きいほど強めに、ただし上限は超えない。
   */
  const shift = Math.min(MAX_RATE_SHIFT, Math.abs(drift) / SYNC_DRIFT_SEEK_MS * MAX_RATE_SHIFT);
  player.nudgeRate(drift > 0 ? 1 - shift : 1 + shift);
}
