import { createReadStream, existsSync, statSync } from "node:fs";
import { stat } from "node:fs/promises";
import { extname, join, resolve, sep } from "node:path";
import { Readable } from "node:stream";

/**
 * 組み上げた画面を配る。
 *
 * 中央サーバーと各自の PC の両方でこれを使う。
 * 中央からはスマホが最初に開く先として、PC からは入れ物の中身として配る。
 * 配るのは画面を組み立てるための材料だけで、音声はここを通らない。
 *
 * 出来合いの配り役は置き場を作業場所からの相対でしか受け取らない。
 * 包みの中の絶対位置を指したいので、自分で読んで返す。
 */

/** 拡張子から中身の種類を決める。分からないものは素の列として渡す。 */
const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
};

/**
 * 求められた道から、実際に返すファイルを決める。
 *
 * 置き場の外へ出る指定は受け付けない。
 * 「..」を重ねれば、包みの外の何でも読めてしまう。
 * 画面の中の移動は入れ物側が受け持つので、無いものは入口に落とす。
 */
export function resolveWebFile(webRoot: string, pathname: string): string {
  let requested: string;
  try {
    requested = decodeURIComponent(pathname);
  } catch {
    // 読めない書き方で来たものは、素直に入口へ返す。
    return join(webRoot, "index.html");
  }

  const target = resolve(webRoot, `.${requested}`);
  const inside = target === webRoot || target.startsWith(webRoot + sep);
  if (inside && existsSync(target) && statSync(target).isFile()) return target;
  return join(webRoot, "index.html");
}

/** 画面のファイルを 1 つ返す。 */
export async function webFileResponse(path: string): Promise<Response> {
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
}

/** 画面を配る役を、受け口に足す。 */
export function attachWebApp(
  app: { get: (path: string, handler: (c: { req: { url: string } }) => Promise<Response>) => void },
  webRoot: string,
): void {
  app.get("/*", async (c) => {
    const pathname = new URL(c.req.url).pathname;

    /*
     * 画面の中の移動と、仕組みへの問い合わせを取り違えない。
     *
     * ここに来た時点で、その道を受け持つものは登録されていない。
     * それでも画面を返すと、頼んだ側は中身として読もうとして
     * 「絵として壊れている」「読めない形が返ってきた」という
     * 元の原因から遠い形で失敗する。無いものは無いと答える。
     */
    if (pathname.startsWith("/api/")) {
      return new Response(JSON.stringify({ error: "not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json; charset=utf-8" },
      });
    }

    return webFileResponse(resolveWebFile(webRoot, pathname));
  });
}
