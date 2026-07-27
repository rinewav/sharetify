import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const NODE_TARGET = process.env.SHARETIFY_NODE_URL ?? "http://127.0.0.1:47821";
const HUB_TARGET = process.env.SHARETIFY_HUB_URL ?? "http://127.0.0.1:47820";

/*
 * 実機から HTTPS で入ってくる場合のホスト名とポート。
 * 指定すると、更新の通知 (HMR) の接続先をそちらに向ける。
 * 指定がなければ従来どおりローカル向けの設定で動く。
 *
 *   SHARETIFY_PUBLIC_HOST=my-machine.tailnet.ts.net
 *   SHARETIFY_PUBLIC_PORT=8443
 */
const PUBLIC_HOST = process.env.SHARETIFY_PUBLIC_HOST;
const PUBLIC_PORT = Number(process.env.SHARETIFY_PUBLIC_PORT ?? 8443);

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5273,
    host: true,
    // Tailscale の MagicDNS 名で入ってくるので、ホスト検査を通す。
    allowedHosts: [".ts.net", "localhost"],
    hmr: PUBLIC_HOST
      ? { protocol: "wss", host: PUBLIC_HOST, clientPort: PUBLIC_PORT }
      : undefined,
    proxy: {
      /*
       * node と hub を同一オリジンにぶら下げる。
       *
       * スマートフォンからは HTTPS で入ってくるので、HTTP の node を
       * ブラウザから直接叩くと混在コンテンツで弾かれる。
       * ここで中継しておけば同一オリジンになり、CORS も混在も起きない。
       */
      // プレフィックスは前方一致なので、`/node` にすると `/node_modules/...` まで
      // 巻き込んでしまう。取り違えようのない名前にしておく。
      "/node-api": {
        target: NODE_TARGET,
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/node-api/, ""),
      },
      "/hub-api": {
        target: HUB_TARGET,
        changeOrigin: true,
        ws: true,
        rewrite: (path) => path.replace(/^\/hub-api/, ""),
      },
    },
  },
});
