import { randomUUID } from "node:crypto";
import type { WSContext } from "hono/ws";
import type {
  ClientMessage,
  ListeningSession,
  ReadinessEntry,
  ServerMessage,
  SessionControl,
  Track,
  User,
} from "@musicshare/shared";
import { expectedPositionMs } from "@musicshare/shared";
import { getUser } from "./store.js";

/**
 * 同時リスニングの中核。
 *
 * ここで配るのは「何を、どこから、いつ時点で鳴らしているか」だけ。
 * 音声そのものは各参加者が自分の node から取ってくるので、
 * この経路に流れるのは毎秒数十バイトの JSON に過ぎない。
 */

interface Connection {
  socket: WSContext;
  user: User;
  sessionId?: string;
  /** 直近に報告された「この曲を用意できたか」。 */
  readiness: Map<string, { ready: boolean; reason?: string }>;
}

const connections = new Map<string, Connection>();
const sessions = new Map<string, ListeningSession>();

export function registerConnection(id: string, socket: WSContext, user: User): void {
  connections.set(id, { socket, user, readiness: new Map() });
}

export function dropConnection(id: string): void {
  const conn = connections.get(id);
  connections.delete(id);
  if (!conn?.sessionId) return;
  leaveSession(id, conn);
}

export function createSession(groupId: string, hostId: string): ListeningSession {
  const session: ListeningSession = {
    id: randomUUID(),
    groupId,
    hostId,
    participantIds: [],
    state: {
      track: null,
      positionMs: 0,
      atServerTime: Date.now(),
      paused: true,
      queue: [],
      queueIndex: 0,
    },
  };
  sessions.set(session.id, session);
  return session;
}

export function listSessions(groupIds: string[]): ListeningSession[] {
  const allowed = new Set(groupIds);
  return [...sessions.values()].filter((s) => allowed.has(s.groupId));
}

export function handleMessage(connectionId: string, raw: string): void {
  const conn = connections.get(connectionId);
  if (!conn) return;

  let message: ClientMessage;
  try {
    message = JSON.parse(raw) as ClientMessage;
  } catch {
    send(conn, { type: "error", message: "malformed message" });
    return;
  }

  switch (message.type) {
    case "sync:ping":
      // 往復遅延を測らせるため、受け取った時刻をそのまま返す。
      send(conn, {
        type: "sync:pong",
        clientTime: message.clientTime,
        serverTime: Date.now(),
      });
      return;

    case "session:join":
      joinSession(connectionId, conn, message.sessionId);
      return;

    case "session:leave":
      leaveSession(connectionId, conn);
      return;

    case "session:control":
      applyControl(conn, message.action);
      return;

    case "session:readiness":
      conn.readiness.set(message.trackId, { ready: message.ready, reason: message.reason });
      broadcastReadiness(conn.sessionId);
      return;
  }
}

function joinSession(connectionId: string, conn: Connection, sessionId: string): void {
  const session = sessions.get(sessionId);
  if (!session) {
    send(conn, { type: "error", message: "session not found" });
    return;
  }
  conn.sessionId = sessionId;
  if (!session.participantIds.includes(conn.user.id)) {
    session.participantIds.push(conn.user.id);
  }
  broadcastState(session);
  broadcastReadiness(sessionId);
}

function leaveSession(connectionId: string, conn: Connection): void {
  const sessionId = conn.sessionId;
  if (!sessionId) return;
  conn.sessionId = undefined;

  const session = sessions.get(sessionId);
  if (!session) return;

  session.participantIds = session.participantIds.filter((id) => id !== conn.user.id);

  if (session.participantIds.length === 0) {
    sessions.delete(sessionId);
    return;
  }

  // ホストが抜けたら、残っている中で最初の人に引き継ぐ。
  // こうしないとホストの離脱でセッションが操作不能になる。
  if (session.hostId === conn.user.id) {
    const nextHost = session.participantIds[0];
    if (nextHost) session.hostId = nextHost;
  }

  broadcastState(session);
  broadcastReadiness(sessionId);
}

function applyControl(conn: Connection, action: SessionControl): void {
  const session = conn.sessionId ? sessions.get(conn.sessionId) : undefined;
  if (!session) {
    send(conn, { type: "error", message: "not in a session" });
    return;
  }
  if (session.hostId !== conn.user.id) {
    send(conn, { type: "error", message: "only the host can control playback" });
    return;
  }

  const state = session.state;
  const now = Date.now();

  switch (action.kind) {
    case "play": {
      // 一時停止していた地点から再開する。基準時刻を今に打ち直す。
      state.paused = false;
      state.atServerTime = now;
      break;
    }
    case "pause": {
      // 止める前に、経過分を position に畳み込んでおく。
      state.positionMs = expectedPositionMs(state, 0, now);
      state.paused = true;
      state.atServerTime = now;
      break;
    }
    case "seek": {
      state.positionMs = Math.max(0, action.positionMs);
      state.atServerTime = now;
      break;
    }
    case "next": {
      moveQueue(session, 1, now);
      break;
    }
    case "prev": {
      // 先頭から 3 秒以上進んでいたら、曲を戻さず頭出しにする。よくある挙動に揃える。
      const position = expectedPositionMs(state, 0, now);
      if (position > 3000) {
        state.positionMs = 0;
        state.atServerTime = now;
      } else {
        moveQueue(session, -1, now);
      }
      break;
    }
    case "setQueue": {
      state.queue = action.tracks;
      state.queueIndex = clampIndex(action.startIndex, action.tracks.length);
      state.track = action.tracks[state.queueIndex] ?? null;
      state.positionMs = 0;
      state.atServerTime = now;
      state.paused = false;
      break;
    }
  }

  broadcastState(session);
}

function moveQueue(session: ListeningSession, delta: number, now: number): void {
  const state = session.state;
  const nextIndex = state.queueIndex + delta;
  if (nextIndex < 0 || nextIndex >= state.queue.length) {
    // キューの端に来たら止める。勝手に巻き戻さない。
    state.paused = true;
    state.positionMs = 0;
    state.atServerTime = now;
    return;
  }
  state.queueIndex = nextIndex;
  state.track = state.queue[nextIndex] ?? null;
  state.positionMs = 0;
  state.atServerTime = now;
}

function clampIndex(index: number, length: number): number {
  if (length === 0) return 0;
  return Math.min(Math.max(0, index), length - 1);
}

function broadcastState(session: ListeningSession): void {
  const message: ServerMessage = { type: "session:state", session };
  for (const conn of connections.values()) {
    if (conn.sessionId === session.id) send(conn, message);
  }
}

/**
 * 「誰がまだその曲を用意できていないか」を全員に配る。
 *
 * 各参加者が別々に音源を取ってくる方式なので、
 * 誰か一人だけ取得に失敗することがありうる。黙って無音になるより、
 * 誰が引っかかっているかを見せたほうが原因に辿り着ける。
 */
function broadcastReadiness(sessionId: string | undefined): void {
  if (!sessionId) return;
  const session = sessions.get(sessionId);
  if (!session) return;

  const trackId = session.state.track?.id;
  if (!trackId) return;

  const entries: ReadinessEntry[] = [];
  for (const conn of connections.values()) {
    if (conn.sessionId !== sessionId) continue;
    const report = conn.readiness.get(trackId);
    entries.push({
      userId: conn.user.id,
      displayName: getUser(conn.user.id)?.displayName ?? conn.user.displayName,
      trackId,
      ready: report?.ready ?? false,
      reason: report?.reason,
    });
  }

  const message: ServerMessage = { type: "session:readiness", entries };
  for (const conn of connections.values()) {
    if (conn.sessionId === sessionId) send(conn, message);
  }
}

function send(conn: Connection, message: ServerMessage): void {
  try {
    conn.socket.send(JSON.stringify(message));
  } catch {
    // 切断済みのソケットへの送信は無視してよい。close 時に掃除される。
  }
}

/** キューの中の Track をそのまま返すヘルパー (テスト用途)。 */
export function sessionTracks(sessionId: string): Track[] {
  return sessions.get(sessionId)?.state.queue ?? [];
}
