/**
 * 機械の中でだけ使えるもの。
 *
 * ファイルを読むなど、閲覧環境には無い仕掛けに触れる。
 * 画面側から取り込むと組み上がらなくなるので、入口を分けている。
 */
export * from "./serve-web.js";
export * from "./artwork-proxy.js";
