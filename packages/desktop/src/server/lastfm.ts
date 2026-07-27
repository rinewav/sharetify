import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { Track } from "@musicshare/shared";

/**
 * 聴いた記録を外部の集計サービスへ送る。
 *
 * 各ユーザーの PC の中で完結させる。鍵と合言葉を持つのはここだけで、
 * 中央サーバーは誰が何を聴いたかを知らない。
 *
 * 署名に使う要約方式が古いものなので、ブラウザ側では素直に作れない。
 * それも手元で行う理由のひとつ。
 */

const API_ROOT = "https://ws.audioscrobbler.com/2.0/";
const CONFIG_PATH = join(homedir(), ".musicshare", "lastfm.json");

interface Config {
  apiKey?: string;
  apiSecret?: string;
  sessionKey?: string;
  username?: string;
}

let config: Config = {};

export async function loadLastfmConfig(): Promise<void> {
  try {
    config = JSON.parse(await readFile(CONFIG_PATH, "utf8")) as Config;
  } catch {
    config = {};
  }
}

async function save(): Promise<void> {
  await mkdir(dirname(CONFIG_PATH), { recursive: true });
  await writeFile(CONFIG_PATH, JSON.stringify(config, null, 2), "utf8");
}

export function lastfmStatus() {
  return {
    configured: Boolean(config.apiKey && config.apiSecret),
    connected: Boolean(config.sessionKey),
    username: config.username,
  };
}

export async function setLastfmKeys(apiKey: string, apiSecret: string): Promise<void> {
  // 鍵を入れ替えたら、それまでの合言葉は通らない。
  config = { apiKey, apiSecret };
  await save();
}

export async function disconnectLastfm(): Promise<void> {
  config = { apiKey: config.apiKey, apiSecret: config.apiSecret };
  await save();
}

/** 呼び出しの署名。並べ替えて繋いだものを要約する決まりになっている。 */
function sign(params: Record<string, string>): string {
  const joined = Object.keys(params)
    .sort()
    .map((key) => `${key}${params[key]}`)
    .join("");
  return createHash("md5")
    .update(joined + (config.apiSecret ?? ""), "utf8")
    .digest("hex");
}

async function callApi(
  method: string,
  params: Record<string, string>,
  options: { post?: boolean; signed?: boolean } = {},
): Promise<Record<string, unknown>> {
  if (!config.apiKey) throw new Error("鍵が設定されていません。");

  const all: Record<string, string> = {
    ...params,
    method,
    api_key: config.apiKey,
  };
  if (options.signed) all["api_sig"] = sign(all);
  all["format"] = "json";

  const body = new URLSearchParams(all);
  const response = await fetch(options.post ? API_ROOT : `${API_ROOT}?${body}`, {
    method: options.post ? "POST" : "GET",
    headers: options.post ? { "Content-Type": "application/x-www-form-urlencoded" } : undefined,
    body: options.post ? body : undefined,
    signal: AbortSignal.timeout(15_000),
  });

  const json = (await response.json()) as Record<string, unknown>;
  if (typeof json["error"] === "number") {
    throw new Error(String(json["message"] ?? "外部サービスから拒否されました。"));
  }
  return json;
}

/**
 * 連携をはじめる。
 * 返した場所を利用者がブラウザで開いて許可すると、次の段階へ進める。
 */
export async function beginLastfmAuth(): Promise<{ token: string; authUrl: string }> {
  const json = await callApi("auth.getToken", {});
  const token = String(json["token"] ?? "");
  if (!token) throw new Error("手続きを開始できませんでした。");
  return {
    token,
    authUrl: `https://www.last.fm/api/auth/?api_key=${config.apiKey}&token=${token}`,
  };
}

/** 許可されたあとに呼ぶ。以降ずっと使う合言葉を受け取る。 */
export async function completeLastfmAuth(token: string): Promise<{ username: string }> {
  const json = await callApi("auth.getSession", { token }, { signed: true });
  const session = json["session"] as { key?: string; name?: string } | undefined;
  if (!session?.key) throw new Error("許可が確認できませんでした。");

  config.sessionKey = session.key;
  config.username = session.name;
  await save();
  return { username: session.name ?? "" };
}

function trackParams(track: Track): Record<string, string> {
  const params: Record<string, string> = {
    artist: track.artist,
    track: track.title,
  };
  if (track.album) params["album"] = track.album;
  if (track.durationMs) params["duration"] = String(Math.round(track.durationMs / 1000));
  return params;
}

export async function updateNowPlaying(track: Track): Promise<void> {
  if (!config.sessionKey) return;
  await callApi(
    "track.updateNowPlaying",
    { ...trackParams(track), sk: config.sessionKey },
    { post: true, signed: true },
  );
}

/** 聴き終えた記録を送る。`playedAt` は再生を始めた時刻 (秒)。 */
export async function scrobble(track: Track, playedAt: number): Promise<void> {
  if (!config.sessionKey) return;
  await callApi(
    "track.scrobble",
    { ...trackParams(track), timestamp: String(playedAt), sk: config.sessionKey },
    { post: true, signed: true },
  );
}
