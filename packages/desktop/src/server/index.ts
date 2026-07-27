import { createReadStream, existsSync, statSync } from "node:fs";
import { stat } from "node:fs/promises";
import { extname, join, resolve, sep } from "node:path";
import { hostname } from "node:os";
import { Readable } from "node:stream";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import {
  NODE_DEFAULT_PORT,
  NODE_ROUTES,
  type DiscoverResponse,
  type LyricsResult,
  type NodeHealth,
  type ResolveResponse,
  type SearchResponse,
  type Track,
} from "@sharetify/shared";
import { artworkResponse } from "@sharetify/shared/server";
import {
  clearHistory as clearHistoryStore,
  historyCount,
  historyCursor,
  historyOrigin,
  historySince,
  listHistory,
  loadHistory,
  mergeHistory,
} from "./history.js";
import {
  cachePathFor,
  cachedCount,
  ensureCached,
  enqueue,
  initCache,
  isCached,
  listEntries,
} from "./cache.js";
import {
  beginLastfmAuth,
  completeLastfmAuth,
  disconnectLastfm,
  lastfmStatus,
  loadLastfmConfig,
  scrobble,
  setLastfmKeys,
  updateNowPlaying,
} from "./lastfm.js";
import { fetchLyrics } from "./lyrics.js";
import { PeerHost } from "./peer.js";
import {
  fetchCollection,
  fetchDiscover,
  fetchRadio,
  isResolverReady,
  resolveStreamUrl,
  ResolverFailure,
  search,
  useToolchain,
} from "./resolver.js";
import {
  inspectToolchain,
  installToolchain,
  updateResolver,
  type ToolchainStatus,
} from "./toolchain.js";

/**
 * node サーバー — 各ユーザーの PC の中だけで動く。
 *
 * 音声の実体が通るのはここだけ。中央サーバーは一切関与しない。
 * クライアントには常にこのサーバーの URL を返し、外部の URL を直接渡さない。
 * そうすることで CORS も Range もこちら側で扱える。
 */

const VERSION = "0.0.1";

/**
 * 引き合わせを頼む先。
 *
 * スマホが開く場所と同じでなければ、互いを見つけられない。
 * 別の場所に立てているときは SHARETIFY_HUB_URL で差し替える。
 */
const DEFAULT_HUB_URL = "https://sharetify.rine.bio";

/** 一度引いた歌詞の控え。曲を行き来するたびに問い合わせない。 */
const lyricsCache = new Map<string, LyricsResult>();

/** 汎用のおすすめの控え。中身の移り変わりが遅いので使い回す。 */
let discoverCache: { at: number; value: DiscoverResponse } | null = null;

export function createNodeApp(): Hono {
  const app = new Hono();

  // 自分のスマホなど、同じ持ち主の別端末から呼ばれる前提。
  app.use("/api/*", cors());

  app.get(NODE_ROUTES.health, async (c) => {
    /*
     * 道具立てが整っているかを答えの中に含める。
     *
     * 整っていないと、探すことも鳴らすこともできない。
     * それを黙っていると「なぜか何も出ない」状態になる。
     */
    const tools = await inspectToolchain();
    const health: NodeHealth = {
      ok: true,
      version: VERSION,
      resolverReady: tools.ready,
      resolverMessage: tools.message,
      cachedTrackCount: cachedCount(),
    };
    return c.json(health);
  });

  /* ------------------------------ 道具立て ------------------------------ */

  app.get("/api/toolchain", async (c) => c.json(await inspectToolchain()));

  /*
   * 足りないものを入れる。
   *
   * 時間がかかるので、どこまで進んだかを送りながら行う。
   * 黙って待たせると、止まっているのか進んでいるのか分からない。
   */
  app.post("/api/toolchain/install", async (c) => {
    const stream = new ReadableStream({
      async start(controller) {
        const send = (payload: unknown) => {
          controller.enqueue(new TextEncoder().encode(`${JSON.stringify(payload)}\n`));
        };

        try {
          const status = await installToolchain((step, detail) => send({ step, detail }));
          useToolchain(status.python, status.resolverBin);
          send({ done: true, status });
        } catch (error) {
          send({ done: true, error: describeAny(error) });
        } finally {
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: { "Content-Type": "application/x-ndjson; charset=utf-8" },
    });
  });

  /** 音を取ってくる仕掛けだけを新しくする。供給元の作りが変わったとき用。 */
  app.post("/api/toolchain/update", async (c) => {
    try {
      await updateResolver();
      const status = await inspectToolchain();
      useToolchain(status.python, status.resolverBin);
      return c.json(status);
    } catch (error) {
      return c.json({ error: describeAny(error) }, 502);
    }
  });

  app.get(NODE_ROUTES.search, async (c) => {
    const query = c.req.query("q")?.trim();
    if (!query) return c.json({ error: "q is required" }, 400);

    const limit = Number(c.req.query("limit") ?? 20);
    try {
      const response: SearchResponse = await search(query, limit);
      return c.json(response);
    } catch (error) {
      return c.json({ error: describe(error) }, 502);
    }
  });

  /** アルバム・プレイリスト・アーティストを開く。 */
  app.get(NODE_ROUTES.collection, async (c) => {
    const kind = c.req.query("kind");
    const id = c.req.query("id")?.trim();
    if (kind !== "album" && kind !== "playlist" && kind !== "artist") {
      return c.json({ error: "kind must be album, playlist or artist" }, 400);
    }
    if (!id) return c.json({ error: "id is required" }, 400);

    try {
      return c.json(await fetchCollection(kind, id));
    } catch (error) {
      return c.json({ error: describe(error) }, 502);
    }
  });

  app.get(NODE_ROUTES.resolve, async (c) => {
    const trackId = c.req.query("trackId")?.trim();
    if (!trackId) return c.json({ error: "trackId is required" }, 400);

    // 手元にあるならそれで済ませる。供給元を無駄に叩かない。
    if (isCached(trackId)) {
      const response: ResolveResponse = {
        trackId,
        url: `${NODE_ROUTES.stream}?trackId=${encodeURIComponent(trackId)}`,
        mimeType: "audio/mp4",
        cached: true,
      };
      return c.json(response);
    }

    try {
      // URL が取れることだけ先に確かめておく。実際の中継は stream 側で行う。
      await resolveStreamUrl(trackId);
      const response: ResolveResponse = {
        trackId,
        url: `${NODE_ROUTES.stream}?trackId=${encodeURIComponent(trackId)}`,
        mimeType: "audio/mp4",
        cached: false,
      };
      return c.json(response);
    } catch (error) {
      return c.json({ error: describe(error) }, 502);
    }
  });

  /*
   * 音声を返す。
   *
   * 供給元の URL をそのまま中継してはいけない。
   * 単発で全部読みにいくと極端に絞られ、実測で 30KB/s 前後しか出なかった。
   * 取得用のコンポーネントに任せれば同じ曲が数秒で揃うので、
   * 一度手元に落としきってから配る。
   *
   * 落としたものは残すので、二度目は即座に鳴り、
   * PC が落ちている間の再生にも回せる。
   */
  app.get(NODE_ROUTES.stream, async (c) => {
    const trackId = c.req.query("trackId")?.trim();
    if (!trackId) return c.json({ error: "trackId is required" }, 400);

    try {
      await ensureCached(trackId);
    } catch (error) {
      return c.json({ error: describe(error) }, 502);
    }
    return streamFromDisk(c, trackId);
  });

  /*
   * ジャケット画像の中継。
   *
   * クライアントに外部の URL を直接叩かせない。取得元をこちらに寄せておくと、
   * どこへ何を取りに行っているかが node の中で完結する。
   * 任意の URL を代理で取りに行くと踏み台になるので、宛先は限定する。
   */
  app.get(NODE_ROUTES.artwork, (c) => artworkResponse(c.req.query("url")));

  app.post(NODE_ROUTES.cache, async (c) => {
    const body = await c.req.json<{ trackIds?: string[] }>().catch(() => null);
    if (!Array.isArray(body?.trackIds)) return c.json({ error: "trackIds is required" }, 400);

    // 完了を待たずに返す。進捗は status で見せる。
    void enqueue(body.trackIds);
    return c.json({ accepted: body.trackIds.length });
  });

  app.get(NODE_ROUTES.cacheStatus, (c) => c.json({ entries: listEntries() }));

  /*
   * 聴いた跡。
   *
   * 端末は替わるし、覚えているものを消すこともある。
   * この PC のほうが長生きするので、寄せ集める場所をこちらに置く。
   * 電話で聴いたものが PC のおすすめに効き、その逆も効く。
   *
   * ここを行き来するのは、この機械と、この機械に繋いだ端末の間だけ。
   * 中央サーバーは通らない。
   */
  app.get(NODE_ROUTES.history, (c) =>
    c.json({
      entries: listHistory(),
      total: historyCount(),
      added: 0,
      cursor: historyCursor(),
      origin: historyOrigin(),
    }),
  );

  app.post(NODE_ROUTES.historyMerge, async (c) => {
    const body = await c.req
      .json<{ entries?: unknown[]; since?: number; origin?: string }>()
      .catch(() => null);
    if (!Array.isArray(body?.entries)) return c.json({ error: "entries is required" }, 400);

    const added = mergeHistory(body.entries);

    /*
     * 端末がまだ知らないぶんだけ返す。
     *
     * 印より後に預かったものを渡す。聴いた時刻で削ると、
     * 別の端末があとから足した古い跡を取りこぼす。
     *
     * ただし印が通じるのは、それを渡したときと同じ代のあいだだけ。
     * 置き場を作り直すと番号は 1 から振り直されるので、
     * 前の代の印をそのまま使うと、同じ番号で別のものを数えることになる。
     */
    const sameOrigin = body.origin === historyOrigin();
    const since =
      sameOrigin && typeof body.since === "number" && Number.isFinite(body.since)
        ? body.since
        : undefined;

    return c.json({
      entries: historySince(since),
      total: historyCount(),
      added,
      cursor: historyCursor(),
      origin: historyOrigin(),
    });
  });

  /** 端末側で捨てたときに、こちらも合わせる。 */
  app.post("/api/history/clear", async (c) => {
    await clearHistoryStore();
    return c.json({ entries: [], total: 0, added: 0, cursor: historyCursor(), origin: historyOrigin() });
  });

  /** ある曲を種に、続けて流す曲を並べる。 */
  app.get(NODE_ROUTES.radio, async (c) => {
    const trackId = c.req.query("trackId")?.trim();
    if (!trackId) return c.json({ error: "trackId is required" }, 400);

    try {
      return c.json(await fetchRadio(trackId, Number(c.req.query("limit") ?? 25)));
    } catch (error) {
      return c.json({ error: describe(error) }, 502);
    }
  });

  /** 地域向けの汎用のおすすめ。移り変わりが遅いので少し長めに覚えておく。 */
  app.get(NODE_ROUTES.discover, async (c) => {
    const cached = discoverCache;
    if (cached && Date.now() - cached.at < 30 * 60_000) return c.json(cached.value);

    try {
      const result = await fetchDiscover(Number(c.req.query("limit") ?? 6));
      discoverCache = { at: Date.now(), value: result };
      return c.json(result);
    } catch (error) {
      return c.json({ error: describe(error) }, 502);
    }
  });

  /*
   * 歌詞。
   *
   * 提供元へ取りに行くのはこの PC。中央サーバーは関与しない。
   * 同じ曲を何度も問い合わせないよう、一度引いたものは覚えておく。
   */
  app.get(NODE_ROUTES.lyrics, async (c) => {
    const title = c.req.query("title")?.trim();
    const artist = c.req.query("artist")?.trim();
    if (!title || !artist) return c.json({ error: "title and artist are required" }, 400);

    const track: Track = {
      id: c.req.query("trackId") ?? `${artist}-${title}`,
      sourceKind: "remote",
      sourceId: c.req.query("trackId") ?? "",
      title,
      artist,
      album: c.req.query("album") || undefined,
      durationMs: Number(c.req.query("durationMs") ?? 0) || undefined,
    };

    const cached = lyricsCache.get(track.id);
    if (cached) return c.json(cached);

    try {
      const result = await fetchLyrics(track);
      lyricsCache.set(track.id, result);
      return c.json(result);
    } catch (error) {
      return c.json({ error: describeAny(error) }, 502);
    }
  });

  /* ------------------------------ 聴取記録 ------------------------------ */

  app.get("/api/lastfm", (c) => c.json(lastfmStatus()));

  app.post("/api/lastfm/keys", async (c) => {
    const body = await c.req.json<{ apiKey?: string; apiSecret?: string }>().catch(() => null);
    const apiKey = body?.apiKey?.trim();
    const apiSecret = body?.apiSecret?.trim();
    if (!apiKey || !apiSecret) return c.json({ error: "鍵と合言葉が必要です。" }, 400);

    await setLastfmKeys(apiKey, apiSecret);
    return c.json(lastfmStatus());
  });

  app.post("/api/lastfm/begin", async (c) => {
    try {
      return c.json(await beginLastfmAuth());
    } catch (error) {
      return c.json({ error: describeAny(error) }, 502);
    }
  });

  app.post("/api/lastfm/complete", async (c) => {
    const body = await c.req.json<{ token?: string }>().catch(() => null);
    if (!body?.token) return c.json({ error: "token is required" }, 400);
    try {
      return c.json(await completeLastfmAuth(body.token));
    } catch (error) {
      return c.json({ error: describeAny(error) }, 502);
    }
  });

  app.post("/api/lastfm/disconnect", async (c) => {
    await disconnectLastfm();
    return c.json(lastfmStatus());
  });

  app.post("/api/lastfm/nowplaying", async (c) => {
    const body = await c.req.json<{ track?: Track }>().catch(() => null);
    if (!body?.track) return c.json({ error: "track is required" }, 400);
    try {
      await updateNowPlaying(body.track);
      return c.json({ ok: true });
    } catch (error) {
      return c.json({ error: describeAny(error) }, 502);
    }
  });

  app.post("/api/lastfm/scrobble", async (c) => {
    const body = await c.req.json<{ track?: Track; playedAt?: number }>().catch(() => null);
    if (!body?.track) return c.json({ error: "track is required" }, 400);
    try {
      await scrobble(body.track, body.playedAt ?? Math.floor(Date.now() / 1000));
      return c.json({ ok: true });
    } catch (error) {
      return c.json({ error: describeAny(error) }, 502);
    }
  });

  return app;
}

function describeAny(error: unknown): string {
  return error instanceof Error ? error.message : "処理に失敗しました。";
}

/** ディスク上のファイルを Range 対応で返す。シークを効かせるために必要。 */
async function streamFromDisk(c: { req: { header: (name: string) => string | undefined } }, trackId: string) {
  const path = cachePathFor(trackId);
  const info = await stat(path);
  const range = c.req.header("range");

  if (!range) {
    const stream = Readable.toWeb(createReadStream(path)) as ReadableStream;
    return new Response(stream, {
      headers: {
        "Content-Type": "audio/mp4",
        "Content-Length": String(info.size),
        "Accept-Ranges": "bytes",
      },
    });
  }

  const match = /bytes=(\d*)-(\d*)/.exec(range);
  const start = match?.[1] ? Number(match[1]) : 0;
  const end = match?.[2] ? Number(match[2]) : info.size - 1;
  const stream = Readable.toWeb(createReadStream(path, { start, end })) as ReadableStream;

  return new Response(stream, {
    status: 206,
    headers: {
      "Content-Type": "audio/mp4",
      "Content-Length": String(end - start + 1),
      "Content-Range": `bytes ${start}-${end}/${info.size}`,
      "Accept-Ranges": "bytes",
    },
  });
}

function describe(error: unknown): string {
  if (error instanceof ResolverFailure) return error.detail.message;
  return "不明なエラーが発生しました。";
}

/** 拡張子から中身の種類を決める。分からないものは素の列として渡す。 */
const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};

/**
 * 画面そのものも、この PC から配る。
 *
 * 開発中は別に立てた配信役から取っているが、配って回るものには
 * それが無い。ここから配れば、同じ URL をスマホからも開けるので、
 * 直結さえできていれば別の仕掛けが要らない。
 *
 * 出来合いの配り役は置き場を作業場所からの相対でしか受け取らない。
 * 包みの中の絶対位置を指したいので、自分で読んで返す。
 */
function serveWebApp(app: Hono, webRoot: string): void {
  app.get("/*", async (c) => {
    const requested = decodeURIComponent(new URL(c.req.url).pathname);

    /*
     * 置き場の外へ出る指定は受け付けない。
     * 「..」を重ねれば、包みの外の何でも読めてしまう。
     */
    const target = resolve(webRoot, `.${requested}`);
    const inside = target === webRoot || target.startsWith(webRoot + sep);
    const path = inside && existsSync(target) && statSync(target).isFile()
      ? target
      // 画面の中の移動は入れ物側が受け持つので、入口を返す。
      : join(webRoot, "index.html");

    const info = await stat(path);
    const type = CONTENT_TYPES[extname(path).toLowerCase()] ?? "application/octet-stream";
    const stream = Readable.toWeb(createReadStream(path)) as ReadableStream;

    return new Response(stream, {
      headers: {
        "Content-Type": type,
        "Content-Length": String(info.size),
        // 中身に応じた名前が付いているものは長く持たせてよい。
        "Cache-Control": path.includes(`${sep}assets${sep}`)
          ? "public, max-age=31536000, immutable"
          : "no-cache",
      },
    });
  });
}

export async function startNodeServer(port = NODE_DEFAULT_PORT, webRoot?: string) {
  await initCache();
  await loadLastfmConfig();
  await loadHistory();

  /*
   * 立ち上げる時点で、使える実行ファイルを見つけておく。
   * 見つからなくても止めない。画面から用意できるようにしてある。
   */
  const tools: ToolchainStatus = await inspectToolchain();
  useToolchain(tools.python, tools.resolverBin);
  console.log(
    tools.ready
      ? "[node] 道具立ては整っています"
      : `[node] 道具立てが足りません: ${tools.message ?? ""}`,
  );
  const app = createNodeApp();

  let host: PeerHost | null = null;

  // 合言葉の状態を画面から見られるようにしておく。
  app.get("/api/pairing", (c) =>
    c.json({
      code: host?.pairCode ?? null,
      guests: host?.guestCount ?? 0,
      enabled: host !== null,
    }),
  );

  // 画面を同梱しているときだけ配る。開発中は別の配信役が受け持つ。
  if (webRoot) serveWebApp(app, webRoot);

  /*
   * 待ち受けに失敗したことを、呼んだ側へ返す。
   *
   * 立ち上げの失敗は後から知らされるので、そのままでは掴めない。
   * 掴めないと、誰も受け止めないまま入れ物ごと落ちる。
   */
  const server = await new Promise<ReturnType<typeof serve>>((resolve, reject) => {
    const created = serve({ fetch: app.fetch, port }, (info) => {
      console.log(`[node] listening on http://localhost:${info.port}`);
      resolve(created);
    });
    created.on("error", reject);
  });

  /*
   * 直結の受け口を開く。
   *
   * これがあるおかげで、利用者は同じネットワークに入る仕掛けを用意しなくても、
   * 合言葉を打つだけで自分の PC を使えるようになる。
   * 中央は引き合わせるだけで、音声はここと相手の間を直接流れる。
   */
  if (process.env.SHARETIFY_PAIRING !== "off") {
    host = new PeerHost(app, {
      /*
       * 名乗り出る先は、スマホが開くのと同じ中央でなければならない。
       * 手元の中央に名乗り出ても、外にいるスマホからは見つけられない。
       */
      hubUrl: process.env.SHARETIFY_HUB_URL ?? DEFAULT_HUB_URL,
      label: hostname(),
      onCode: (code) => console.log(`[peer] 合言葉: ${code}`),
      onGuestCountChange: (count) => console.log(`[peer] 接続中の端末: ${count}`),
    });
    host.start();
  }

  return server;
}
