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
import { usePlayer } from "./player-store.js";

/**
 * 同時リスニング。
 *
 * 音は誰からも送られてこない。参加者はそれぞれ自分の node から同じ曲を取得し、
 * hub が配る「いつ時点で何秒の位置か」に自分を合わせにいく。
 * だから hub の帯域は毎秒数十バイトで済み、中継も要らない。
 */

export interface Participant {
  userId: string;
  displayName: string;
  ready: boolean;
  reason?: string;
  isHost: boolean;
}

interface SessionState {
  connected: boolean;
  session: ListeningSession | null;
  participants: Participant[];
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
  reportReadiness: (trackId: string, ready: boolean, reason?: string) => void;
  /** 集まりの中で始める。既に誰かが始めていればそこへ入る。 */
  startForGroup: (groupId: string) => Promise<void>;
}

let socket: WebSocket | null = null;
let pingTimer: ReturnType<typeof setInterval> | null = null;
let driftTimer: ReturnType<typeof setInterval> | null = null;

export const useSession = create<SessionState>((set, get) => ({
  connected: false,
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
    set({ connected: false, session: null, participants: [] });
    usePlayer.getState().setSessionRole(false, false);
  },

  joinSession: (sessionId) => sendMessage({ type: "session:join", sessionId }),

  leaveSession: () => {
    sendMessage({ type: "session:leave" });
    set({ session: null, participants: [] });
    usePlayer.getState().setSessionRole(false, false);
  },

  control: (action) => sendMessage({ type: "session:control", action }),

  reportReadiness: (trackId, ready, reason) =>
    sendMessage({ type: "session:readiness", trackId, ready, reason }),

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
      const myUserId = get().myUserId;
      set({ session });

      const player = usePlayer.getState();
      player.setSessionRole(true, session.hostId === myUserId);

      // キューと曲がホスト側で変わったら追随する。
      const track = session.state.track;
      if (track) {
        const sameQueue =
          player.queue.length === session.state.queue.length &&
          player.queue.every((t, i) => t.id === session.state.queue[i]?.id);
        if (!sameQueue) {
          player.playQueue(session.state.queue, session.state.queueIndex);
        } else if (player.index !== session.state.queueIndex) {
          player.playQueue(session.state.queue, session.state.queueIndex);
        }
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
    userId: entry.userId,
    displayName: entry.displayName,
    ready: entry.ready,
    reason: entry.reason,
    isHost: session?.hostId === entry.userId,
  }));
}

/**
 * 自分の再生位置を、hub が示す位置に寄せる。
 *
 * 小さいズレでシークすると音が途切れて耳につくので、
 * わずかなら次の tick で吸収させ、大きく外れたときだけ跳ばす。
 */
function reconcile(get: Get, set: Set): void {
  const { session, clockOffsetMs } = get();
  if (!session?.state.track) return;

  const player = usePlayer.getState();
  const target = expectedPositionMs(session.state, clockOffsetMs);
  const drift = player.positionMs - target;
  set({ driftMs: drift });

  if (Math.abs(drift) >= SYNC_DRIFT_SEEK_MS) {
    player.seek(target);
    return;
  }
  if (Math.abs(drift) >= SYNC_DRIFT_NUDGE_MS) {
    // 一気に飛ばさず、差の半分だけ詰める。数秒かけて滑らかに揃う。
    player.seek(player.positionMs - drift / 2);
  }
}
