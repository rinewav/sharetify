import { cp, rm, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * 組み上げた画面を、アプリの中へ運び入れる。
 *
 * 配って回るものには配信役が付いてこないので、画面も一緒に包む。
 * 走らせるときは手元の node サーバーがここから配る。
 */

const here = dirname(fileURLToPath(import.meta.url));
const from = join(here, "..", "..", "web", "dist");
const to = join(here, "..", "dist", "web");

const built = await stat(join(from, "index.html")).catch(() => null);
if (!built) {
  console.error("画面が組み上がっていません。先に web を組み上げてください。");
  process.exit(1);
}

await rm(to, { recursive: true, force: true });
await cp(from, to, { recursive: true });
console.log(`画面を同梱しました: ${to}`);
