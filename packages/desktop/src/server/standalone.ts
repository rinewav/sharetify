import { NODE_DEFAULT_PORT } from "@musicshare/shared";
import { startNodeServer } from "./index.js";

/** Electron を起動せずに node サーバーだけ動かす開発用エントリ。 */
await startNodeServer(Number(process.env.PORT ?? NODE_DEFAULT_PORT));
