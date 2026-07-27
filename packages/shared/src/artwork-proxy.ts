/**
 * ジャケットを代わりに取ってくる役。
 *
 * クライアントに外部の URL を直接叩かせない。取得元を寄せておくと、
 * どこへ何を取りに行っているかがこちら側で完結する。
 * 任意の URL を代理で取りに行くと踏み台になるので、宛先は限定する。
 *
 * 各自の PC と中央サーバーの両方が同じことをする。
 * PC につないでいる間はそちらから、まだつないでいない間は中央から。
 * どちらも同じ扱いにしたいので、判断も取得もここ一箇所に置く。
 *
 * ここを通るのは表紙の絵だけで、音声は通らない。
 */

/** 取得を許す宛先。ここ以外へは代理アクセスしない。 */
const ARTWORK_HOSTS = ["googleusercontent.com", "ytimg.com", "ggpht.com"];

export function isAllowedArtworkHost(hostname: string): boolean {
  return ARTWORK_HOSTS.some(
    (allowed) => hostname === allowed || hostname.endsWith(`.${allowed}`),
  );
}

/**
 * 頼まれた絵を取ってきて返す。
 *
 * 同じ絵を何度も取りに行かないよう、長めに持たせる。
 * 絵は中身が変わったら URL ごと変わるので、古いものを掴む心配はない。
 */
export async function artworkResponse(raw: string | undefined): Promise<Response> {
  if (!raw) return json({ error: "url is required" }, 400);

  let target: URL;
  try {
    target = new URL(raw);
  } catch {
    return json({ error: "invalid url" }, 400);
  }

  if (target.protocol !== "https:" || !isAllowedArtworkHost(target.hostname)) {
    return json({ error: "not allowed" }, 403);
  }

  try {
    const upstream = await fetch(target, { signal: AbortSignal.timeout(10_000) });
    if (!upstream.ok || !upstream.body) return json({ error: "取得できませんでした" }, 502);

    return new Response(upstream.body, {
      headers: {
        "Content-Type": upstream.headers.get("content-type") ?? "image/jpeg",
        "Cache-Control": "public, max-age=604800, immutable",
      },
    });
  } catch {
    return json({ error: "取得できませんでした" }, 502);
  }
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}
