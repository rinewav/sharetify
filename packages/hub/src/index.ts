import { randomUUID } from "node:crypto";
import { serve } from "@hono/node-server";
import { createNodeWebSocket } from "@hono/node-ws";
import { Hono } from "hono";
import { cors } from "hono/cors";
import {
  HUB_DEFAULT_PORT,
  PAIR_ROUTE,
  type LoginRequest,
  type LoginResponse,
  type MeResponse,
} from "@musicshare/shared";
import {
  createGroup,
  createPlaylist,
  createUser,
  groupsForUser,
  joinGroup,
  loadStore,
  playlistsForUser,
  updatePlaylistTracks,
  userForToken,
} from "./store.js";
import {
  createSession,
  dropConnection,
  handleMessage,
  listSessions,
  registerConnection,
} from "./sessions.js";
import {
  closeGuest,
  closeHost,
  handleGuestMessage,
  handleHostMessage,
  openGuest,
  openHost,
  pairingStats,
} from "./pairing.js";

/**
 * 中央サーバー。
 *
 * ここを流れるのは識別子・メタデータ・再生位置だけ。音声は通らない。
 * その前提を崩さない限り、帯域も運用コストも規模に比例して増えない。
 */

const app = new Hono();
const { injectWebSocket, upgradeWebSocket } = createNodeWebSocket({ app });

app.use("/api/*", cors());

app.get("/api/health", (c) => c.json({ ok: true, service: "hub", pairing: pairingStats() }));

app.post("/api/auth/login", async (c) => {
  const body = await c.req.json<LoginRequest>().catch(() => null);
  const displayName = body?.displayName?.trim();
  if (!displayName) return c.json({ error: "displayName is required" }, 400);

  const { user, token } = createUser(displayName);
  const response: LoginResponse = { token, user };
  return c.json(response);
});

/** Authorization ヘッダからユーザーを引く。無ければ 401。 */
function requireUser(authorization: string | undefined) {
  const token = authorization?.replace(/^Bearer\s+/i, "");
  return userForToken(token);
}

app.get("/api/me", (c) => {
  const user = requireUser(c.req.header("authorization"));
  if (!user) return c.json({ error: "unauthorized" }, 401);

  const response: MeResponse = {
    user,
    groups: groupsForUser(user.id),
    playlists: playlistsForUser(user.id),
  };
  return c.json(response);
});

app.post("/api/groups", async (c) => {
  const user = requireUser(c.req.header("authorization"));
  if (!user) return c.json({ error: "unauthorized" }, 401);

  const body = await c.req.json<{ name?: string }>().catch(() => null);
  const name = body?.name?.trim();
  if (!name) return c.json({ error: "name is required" }, 400);

  return c.json(createGroup(name, user.id));
});

app.post("/api/groups/:id/join", (c) => {
  const user = requireUser(c.req.header("authorization"));
  if (!user) return c.json({ error: "unauthorized" }, 401);

  const group = joinGroup(c.req.param("id"), user.id);
  if (!group) return c.json({ error: "group not found" }, 404);
  return c.json(group);
});

app.post("/api/playlists", async (c) => {
  const user = requireUser(c.req.header("authorization"));
  if (!user) return c.json({ error: "unauthorized" }, 401);

  const body = await c.req
    .json<{ name?: string; groupId?: string; description?: string }>()
    .catch(() => null);
  const name = body?.name?.trim();
  if (!name) return c.json({ error: "name is required" }, 400);

  return c.json(
    createPlaylist({
      name,
      ownerId: user.id,
      groupId: body?.groupId,
      description: body?.description,
    }),
  );
});

app.put("/api/playlists/:id/tracks", async (c) => {
  const user = requireUser(c.req.header("authorization"));
  if (!user) return c.json({ error: "unauthorized" }, 401);

  const body = await c.req.json<{ trackIds?: string[] }>().catch(() => null);
  if (!Array.isArray(body?.trackIds)) return c.json({ error: "trackIds is required" }, 400);

  const playlist = updatePlaylistTracks(c.req.param("id"), body.trackIds);
  if (!playlist) return c.json({ error: "playlist not found" }, 404);
  return c.json(playlist);
});

app.get("/api/sessions", (c) => {
  const user = requireUser(c.req.header("authorization"));
  if (!user) return c.json({ error: "unauthorized" }, 401);

  const groupIds = groupsForUser(user.id).map((g) => g.id);
  return c.json(listSessions(groupIds));
});

app.post("/api/sessions", async (c) => {
  const user = requireUser(c.req.header("authorization"));
  if (!user) return c.json({ error: "unauthorized" }, 401);

  const body = await c.req.json<{ groupId?: string }>().catch(() => null);
  const groupId = body?.groupId;
  if (!groupId) return c.json({ error: "groupId is required" }, 400);

  return c.json(createSession(groupId, user.id));
});

app.get(
  "/ws",
  upgradeWebSocket((c) => {
    // WebSocket ではヘッダを付けられないクライアントがあるので、トークンはクエリで受ける。
    const user = userForToken(c.req.query("token"));
    const connectionId = randomUUID();

    return {
      onOpen(_event, ws) {
        if (!user) {
          ws.send(JSON.stringify({ type: "error", message: "unauthorized" }));
          ws.close();
          return;
        }
        registerConnection(connectionId, ws, user);
      },
      onMessage(event) {
        if (!user) return;
        const data = typeof event.data === "string" ? event.data : String(event.data);
        handleMessage(connectionId, data);
      },
      onClose() {
        dropConnection(connectionId);
      },
      onError() {
        dropConnection(connectionId);
      },
    };
  }),
);

/*
 * 引き合わせ用の口。
 *
 * 中央がここでするのは、PC とスマートフォンを結びつけて接続情報を渡すことだけ。
 * 直結できたあとの通信はここを通らない。
 * アカウントを持っていなくても繋げたいので、認証は課していない。
 */
app.get(
  PAIR_ROUTE,
  upgradeWebSocket((c) => {
    const role = c.req.query("role") === "host" ? "host" : "guest";
    let id = "";

    return {
      onOpen(_event, ws) {
        id = role === "host" ? openHost(ws) : openGuest(ws);
      },
      onMessage(event) {
        const data = typeof event.data === "string" ? event.data : String(event.data);
        if (role === "host") handleHostMessage(id, data);
        else handleGuestMessage(id, data);
      },
      onClose() {
        if (role === "host") closeHost(id);
        else closeGuest(id);
      },
      onError() {
        if (role === "host") closeHost(id);
        else closeGuest(id);
      },
    };
  }),
);

const port = Number(process.env.PORT ?? HUB_DEFAULT_PORT);

await loadStore();

const server = serve({ fetch: app.fetch, port }, (info) => {
  console.log(`[hub] listening on http://localhost:${info.port}`);
});

injectWebSocket(server);
