import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import {
  NODE_DEFAULT_PORT,
  NODE_ROUTES,
  type NodeHealth,
  type ResolveResponse,
  type SearchResponse,
} from "@musicshare/shared";
import { cachePathFor, cachedCount, enqueue, initCache, isCached, listEntries } from "./cache.js";
import { isResolverReady, resolveStreamUrl, ResolverFailure, search } from "./resolver.js";

/**
 * node サーバー — 各ユーザーの PC の中だけで動く。
 *
 * 音声の実体が通るのはここだけ。中央サーバーは一切関与しない。
 * クライアントには常にこのサーバーの URL を返し、外部の URL を直接渡さない。
 * そうすることで CORS も Range もこちら側で扱える。
 */

const VERSION = "0.1.0";

export function createNodeApp(): Hono {
  const app = new Hono();

  // 自分のスマホなど、同じ持ち主の別端末から呼ばれる前提。
  app.use("/api/*", cors());

  app.get(NODE_ROUTES.health, async (c) => {
    const resolver = await isResolverReady();
    const health: NodeHealth = {
      ok: true,
      version: VERSION,
      resolverReady: resolver.ready,
      resolverMessage: resolver.message,
      cachedTrackCount: cachedCount(),
    };
    return c.json(health);
  });

  app.get(NODE_ROUTES.search, async (c) => {
    const query = c.req.query("q")?.trim();
    if (!query) return c.json({ error: "q is required" }, 400);

    const limit = Number(c.req.query("limit") ?? 20);
    try {
      const response: SearchResponse = { tracks: await search(query, limit) };
      return c.json(response);
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

  app.get(NODE_ROUTES.stream, async (c) => {
    const trackId = c.req.query("trackId")?.trim();
    if (!trackId) return c.json({ error: "trackId is required" }, 400);

    if (isCached(trackId)) return streamFromDisk(c, trackId);

    try {
      const upstream = await resolveStreamUrl(trackId);
      const range = c.req.header("range");
      const response = await fetch(upstream, {
        headers: range ? { Range: range } : undefined,
      });

      if (!response.body) return c.json({ error: "配信を取得できませんでした。" }, 502);

      const headers = new Headers();
      headers.set("Content-Type", response.headers.get("content-type") ?? "audio/mp4");
      headers.set("Accept-Ranges", "bytes");
      for (const key of ["content-length", "content-range"]) {
        const value = response.headers.get(key);
        if (value) headers.set(key, value);
      }
      return new Response(response.body, { status: response.status, headers });
    } catch (error) {
      return c.json({ error: describe(error) }, 502);
    }
  });

  /*
   * ジャケット画像の中継。
   *
   * クライアントに外部の URL を直接叩かせない。取得元をこちらに寄せておくと、
   * どこへ何を取りに行っているかが node の中で完結する。
   * 任意の URL を代理で取りに行くと踏み台になるので、宛先は限定する。
   */
  app.get(NODE_ROUTES.artwork, async (c) => {
    const raw = c.req.query("url");
    if (!raw) return c.json({ error: "url is required" }, 400);

    let target: URL;
    try {
      target = new URL(raw);
    } catch {
      return c.json({ error: "invalid url" }, 400);
    }

    if (target.protocol !== "https:" || !isAllowedArtworkHost(target.hostname)) {
      return c.json({ error: "not allowed" }, 403);
    }

    try {
      const upstream = await fetch(target, { signal: AbortSignal.timeout(10_000) });
      if (!upstream.ok || !upstream.body) return c.json({ error: "取得できませんでした" }, 502);

      return new Response(upstream.body, {
        headers: {
          "Content-Type": upstream.headers.get("content-type") ?? "image/jpeg",
          // 同じ絵を何度も取りに行かない。
          "Cache-Control": "public, max-age=86400, immutable",
        },
      });
    } catch {
      return c.json({ error: "取得できませんでした" }, 502);
    }
  });

  app.post(NODE_ROUTES.cache, async (c) => {
    const body = await c.req.json<{ trackIds?: string[] }>().catch(() => null);
    if (!Array.isArray(body?.trackIds)) return c.json({ error: "trackIds is required" }, 400);

    // 完了を待たずに返す。進捗は status で見せる。
    void enqueue(body.trackIds);
    return c.json({ accepted: body.trackIds.length });
  });

  app.get(NODE_ROUTES.cacheStatus, (c) => c.json({ entries: listEntries() }));

  return app;
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

/** ジャケットの取得を許す宛先。ここ以外へは代理アクセスしない。 */
const ARTWORK_HOSTS = ["googleusercontent.com", "ytimg.com", "ggpht.com"];

function isAllowedArtworkHost(hostname: string): boolean {
  return ARTWORK_HOSTS.some(
    (allowed) => hostname === allowed || hostname.endsWith(`.${allowed}`),
  );
}

export async function startNodeServer(port = NODE_DEFAULT_PORT) {
  await initCache();
  const app = createNodeApp();
  return serve({ fetch: app.fetch, port }, (info) => {
    console.log(`[node] listening on http://localhost:${info.port}`);
  });
}
