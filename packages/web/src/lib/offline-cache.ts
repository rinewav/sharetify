/**
 * 端末に曲を残しておく仕組み。
 *
 * この構成では PC が落ちている間、手元にあるものしか鳴らせない。
 * だからここは「あると便利な機能」ではなく、再生経路のひとつ。
 *
 * 一度受け取った曲はそのまま残し、次からはそちらを使う。
 * 取りに行かずに済むぶん頭出しも速くなる。
 */

const CACHE_NAME = "sharetify-audio-v1";
/** 保存できる上限。端末の空きを食い尽くさないよう頭を押さえる。 */
const MAX_BYTES = 2 * 1024 * 1024 * 1024;

/** 保存した順を覚えておき、あふれたら古いものから捨てる。 */
const ORDER_KEY = "sharetify.cache-order";

function keyFor(trackId: string): string {
  return `/offline-audio/${encodeURIComponent(trackId)}`;
}

function readOrder(): string[] {
  try {
    return JSON.parse(localStorage.getItem(ORDER_KEY) ?? "[]") as string[];
  } catch {
    return [];
  }
}

function writeOrder(order: string[]): void {
  localStorage.setItem(ORDER_KEY, JSON.stringify(order));
}

function supported(): boolean {
  return typeof caches !== "undefined";
}

export async function getCached(trackId: string): Promise<Blob | null> {
  if (!supported()) return null;
  try {
    const cache = await caches.open(CACHE_NAME);
    const hit = await cache.match(keyFor(trackId));
    return hit ? await hit.blob() : null;
  } catch {
    return null;
  }
}

export async function putCached(trackId: string, blob: Blob): Promise<void> {
  if (!supported() || blob.size === 0) return;
  try {
    const cache = await caches.open(CACHE_NAME);
    await cache.put(
      keyFor(trackId),
      new Response(blob, {
        headers: {
          "Content-Type": blob.type || "audio/mp4",
          "Content-Length": String(blob.size),
        },
      }),
    );

    const order = readOrder().filter((id) => id !== trackId);
    order.push(trackId);
    writeOrder(order);

    await evictIfNeeded();
  } catch {
    // 空きがないなどで保存できなくても、再生そのものは続けられる。
  }
}

export async function removeCached(trackId: string): Promise<void> {
  if (!supported()) return;
  try {
    const cache = await caches.open(CACHE_NAME);
    await cache.delete(keyFor(trackId));
    writeOrder(readOrder().filter((id) => id !== trackId));
  } catch {
    // 消せなくても実害はない。
  }
}

export async function listCached(): Promise<Set<string>> {
  if (!supported()) return new Set();
  try {
    const cache = await caches.open(CACHE_NAME);
    const keys = await cache.keys();
    return new Set(
      keys
        .map((request) => new URL(request.url).pathname.split("/").pop())
        .filter((id): id is string => Boolean(id))
        .map((id) => decodeURIComponent(id)),
    );
  } catch {
    return new Set();
  }
}

export async function cacheUsage(): Promise<{ bytes: number; count: number }> {
  if (!supported()) return { bytes: 0, count: 0 };
  try {
    const cache = await caches.open(CACHE_NAME);
    const keys = await cache.keys();
    let bytes = 0;
    for (const request of keys) {
      const hit = await cache.match(request);
      const length = hit?.headers.get("content-length");
      if (length) bytes += Number(length);
    }
    return { bytes, count: keys.length };
  } catch {
    return { bytes: 0, count: 0 };
  }
}

export async function clearCache(): Promise<void> {
  if (!supported()) return;
  await caches.delete(CACHE_NAME);
  writeOrder([]);
}

/** 上限を超えたら、置いてから時間が経ったものを順に捨てる。 */
async function evictIfNeeded(): Promise<void> {
  const { bytes } = await cacheUsage();
  if (bytes <= MAX_BYTES) return;

  const cache = await caches.open(CACHE_NAME);
  const order = readOrder();
  let remaining = bytes;

  for (const trackId of order) {
    if (remaining <= MAX_BYTES) break;
    const hit = await cache.match(keyFor(trackId));
    const length = Number(hit?.headers.get("content-length") ?? 0);
    await cache.delete(keyFor(trackId));
    remaining -= length;
  }

  const survivors = await listCached();
  writeOrder(order.filter((id) => survivors.has(id)));
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}
