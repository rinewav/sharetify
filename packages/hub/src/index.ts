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
  type Track,
} from "@sharetify/shared";
import {
  addTrackToPlaylist,
  canAccessPlaylist,
  createGroup,
  createPlaylist,
  createUser,
  deletePlaylist,
  followArtist,
  followsFor,
  getGroup,
  getPlaylist,
  groupsForUser,
  joinGroupByCode,
  leaveGroup,
  likeTrack,
  likesFor,
  loadStore,
  membersOf,
  playlistsForUser,
  removeTrackFromPlaylist,
  renameUser,
  setPlaylistTracks,
  unfollowArtist,
  unlikeTrack,
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

/** 集まりに表示用の名前を添えて返す。 */
function withMembers(user: { id: string }) {
  return groupsForUser(user.id).map((group) => ({ ...group, members: membersOf(group) }));
}

app.get("/api/me", (c) => {
  const user = requireUser(c.req.header("authorization"));
  if (!user) return c.json({ error: "unauthorized" }, 401);

  const response: MeResponse = {
    user,
    groups: withMembers(user),
    playlists: playlistsForUser(user.id),
    follows: followsFor(user.id),
    likes: likesFor(user.id),
  };
  return c.json(response);
});

/* ------------------------------ フォロー ------------------------------ */

app.post("/api/follows", async (c) => {
  const user = requireUser(c.req.header("authorization"));
  if (!user) return c.json({ error: "unauthorized" }, 401);

  const body = await c.req
    .json<{ id?: string; name?: string; artworkUrl?: string }>()
    .catch(() => null);
  if (!body?.id || !body.name) return c.json({ error: "id and name are required" }, 400);

  return c.json(
    followArtist(user.id, { id: body.id, name: body.name, artworkUrl: body.artworkUrl }),
  );
});

app.delete("/api/follows/:id", (c) => {
  const user = requireUser(c.req.header("authorization"));
  if (!user) return c.json({ error: "unauthorized" }, 401);

  return c.json(unfollowArtist(user.id, c.req.param("id")));
});

/* ------------------------------ 気に入った曲 ------------------------------ */

app.post("/api/likes", async (c) => {
  const user = requireUser(c.req.header("authorization"));
  if (!user) return c.json({ error: "unauthorized" }, 401);

  const body = await c.req.json<{ track?: Track }>().catch(() => null);
  if (!body?.track?.id) return c.json({ error: "track is required" }, 400);

  return c.json(likeTrack(user.id, body.track));
});

app.delete("/api/likes/:trackId", (c) => {
  const user = requireUser(c.req.header("authorization"));
  if (!user) return c.json({ error: "unauthorized" }, 401);

  return c.json(unlikeTrack(user.id, c.req.param("trackId")));
});

app.patch("/api/me", async (c) => {
  const user = requireUser(c.req.header("authorization"));
  if (!user) return c.json({ error: "unauthorized" }, 401);

  const body = await c.req.json<{ displayName?: string }>().catch(() => null);
  const displayName = body?.displayName?.trim();
  if (!displayName) return c.json({ error: "displayName is required" }, 400);

  return c.json(renameUser(user.id, displayName));
});

/* ------------------------------- グループ ------------------------------- */

app.post("/api/groups", async (c) => {
  const user = requireUser(c.req.header("authorization"));
  if (!user) return c.json({ error: "unauthorized" }, 401);

  const body = await c.req.json<{ name?: string }>().catch(() => null);
  const name = body?.name?.trim();
  if (!name) return c.json({ error: "name is required" }, 400);

  const group = createGroup(name, user.id);
  return c.json({ ...group, members: membersOf(group) });
});

app.post("/api/groups/join", async (c) => {
  const user = requireUser(c.req.header("authorization"));
  if (!user) return c.json({ error: "unauthorized" }, 401);

  const body = await c.req.json<{ code?: string }>().catch(() => null);
  const code = body?.code?.trim();
  if (!code) return c.json({ error: "code is required" }, 400);

  const group = joinGroupByCode(code, user.id);
  if (!group) return c.json({ error: "合言葉が違います。" }, 404);
  return c.json({ ...group, members: membersOf(group) });
});

app.post("/api/groups/:id/leave", (c) => {
  const user = requireUser(c.req.header("authorization"));
  if (!user) return c.json({ error: "unauthorized" }, 401);

  const group = getGroup(c.req.param("id"));
  if (!group?.memberIds.includes(user.id)) return c.json({ error: "group not found" }, 404);

  leaveGroup(group.id, user.id);
  return c.json({ ok: true });
});

/* ------------------------------ プレイリスト ------------------------------ */

app.post("/api/playlists", async (c) => {
  const user = requireUser(c.req.header("authorization"));
  if (!user) return c.json({ error: "unauthorized" }, 401);

  const body = await c.req
    .json<{ name?: string; groupId?: string; description?: string }>()
    .catch(() => null);
  const name = body?.name?.trim();
  if (!name) return c.json({ error: "name is required" }, 400);

  // 共有として作るなら、その集まりに入っている必要がある。
  if (body?.groupId && !getGroup(body.groupId)?.memberIds.includes(user.id)) {
    return c.json({ error: "group not found" }, 404);
  }

  return c.json(
    createPlaylist({
      name,
      ownerId: user.id,
      groupId: body?.groupId,
      description: body?.description,
    }),
  );
});

/** 触ってよい相手かを確かめてからプレイリストを渡す。 */
function playlistFor(c: { req: { header: (n: string) => string | undefined; param: (n: string) => string } }) {
  const user = requireUser(c.req.header("authorization"));
  if (!user) return { error: "unauthorized" as const, status: 401 as const };

  const playlist = getPlaylist(c.req.param("id"));
  if (!playlist || !canAccessPlaylist(playlist, user.id)) {
    return { error: "playlist not found" as const, status: 404 as const };
  }
  return { user, playlist };
}

app.put("/api/playlists/:id/tracks", async (c) => {
  const found = playlistFor(c);
  if ("error" in found) return c.json({ error: found.error }, found.status);

  const body = await c.req.json<{ tracks?: Track[] }>().catch(() => null);
  if (!Array.isArray(body?.tracks)) return c.json({ error: "tracks is required" }, 400);

  return c.json(setPlaylistTracks(found.playlist.id, body.tracks));
});

app.post("/api/playlists/:id/tracks", async (c) => {
  const found = playlistFor(c);
  if ("error" in found) return c.json({ error: found.error }, found.status);

  const body = await c.req.json<{ track?: Track }>().catch(() => null);
  if (!body?.track?.id) return c.json({ error: "track is required" }, 400);

  return c.json(addTrackToPlaylist(found.playlist.id, body.track));
});

app.delete("/api/playlists/:id/tracks/:trackId", (c) => {
  const found = playlistFor(c);
  if ("error" in found) return c.json({ error: found.error }, found.status);

  return c.json(removeTrackFromPlaylist(found.playlist.id, c.req.param("trackId")));
});

app.delete("/api/playlists/:id", (c) => {
  const found = playlistFor(c);
  if ("error" in found) return c.json({ error: found.error }, found.status);

  // 消せるのは作った人だけ。共有でも他人のものは触らせない。
  if (found.playlist.ownerId !== found.user.id) {
    return c.json({ error: "作成者だけが削除できます。" }, 403);
  }

  deletePlaylist(found.playlist.id);
  return c.json({ ok: true });
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
