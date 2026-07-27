import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Track } from "@musicshare/shared";

/**
 * ストリーム解決。
 *
 * ここは各ユーザーの PC の中でだけ動く。自宅の回線から自分のために取得するので、
 * 中央サーバーが代わりに叩きにいくことはない。
 *
 * 解決系のバックエンドは供給元の仕様変更で壊れることがある。
 * 壊れたときに「なぜか無音」にならないよう、失敗は必ず理由付きで返す。
 */

const RESOLVER_BIN = process.env.MUSICSHARE_RESOLVER ?? "yt-dlp";
const PYTHON_BIN = process.env.MUSICSHARE_PYTHON ?? "python3";

/** カタログ検索スクリプトの場所。ビルド後もソース側を参照する。 */
const CATALOG_SCRIPT = join(dirname(fileURLToPath(import.meta.url)), "ytmusic_search.py");

export interface ResolverError {
  kind: "unavailable" | "failed";
  message: string;
}

export class ResolverFailure extends Error {
  constructor(readonly detail: ResolverError) {
    super(detail.message);
    this.name = "ResolverFailure";
  }
}

function run(bin: string, args: string[], timeoutMs = 30_000): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"] });

    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(
        new ResolverFailure({ kind: "failed", message: `解決がタイムアウトしました (${timeoutMs}ms)` }),
      );
    }, timeoutMs);

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    child.on("error", () => {
      clearTimeout(timer);
      reject(
        new ResolverFailure({
          kind: "unavailable",
          message: `${bin} が見つかりません。初回セットアップを実行してください。`,
        }),
      );
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve(stdout);
        return;
      }
      reject(new ResolverFailure({ kind: "failed", message: summarize(stderr) }));
    });
  });
}

/**
 * stderr から利用者に見せる一行を作る。
 * 供給元の bot 判定に当たったケースは頻度が高いので、専用の案内に振り分ける。
 */
function summarize(stderr: string): string {
  const text = stderr.trim();
  if (/sign in to confirm|not a bot|po_?token/i.test(text)) {
    return "供給元の確認に失敗しました。解決コンポーネントの更新が必要な可能性があります。";
  }
  if (/unavailable|private|removed/i.test(text)) {
    return "この項目は取得できませんでした（非公開または削除済み）。";
  }
  const firstLine = text.split("\n").at(-1) ?? "";
  return firstLine.slice(0, 200) || "解決に失敗しました。";
}

export async function isResolverReady(): Promise<{ ready: boolean; message?: string }> {
  try {
    await run(RESOLVER_BIN, ["--version"], 10_000);
    return { ready: true };
  } catch (error) {
    const message =
      error instanceof ResolverFailure ? error.detail.message : "解決コンポーネントを起動できません。";
    return { ready: false, message };
  }
}

interface RawSearchEntry {
  id?: string;
  title?: string;
  uploader?: string;
  channel?: string;
  album?: string;
  duration?: number;
}

interface CatalogResult {
  tracks?: (Track & { durationMs?: number | null; album?: string | null })[];
  error?: string;
  message?: string;
}

/**
 * 検索。
 *
 * まず楽曲カタログを引く。動画としての検索だと、末尾に無音や静止画が続くものや
 * 数時間のミックスばかりが上位に来てしまい、曲名とアーティストも分離できない。
 * カタログ側が使えないときだけ、動画検索に落とす。
 */
export async function search(query: string, limit = 20): Promise<Track[]> {
  try {
    return await catalogSearch(query, limit);
  } catch {
    return await videoSearch(query, limit);
  }
}

async function catalogSearch(query: string, limit: number): Promise<Track[]> {
  const stdout = await run(PYTHON_BIN, [CATALOG_SCRIPT, query, String(limit)], 45_000);

  const parsed = JSON.parse(stdout) as CatalogResult;
  if (parsed.error || !parsed.tracks) {
    throw new ResolverFailure({
      kind: parsed.error === "unavailable" ? "unavailable" : "failed",
      message: parsed.message ?? "カタログ検索に失敗しました。",
    });
  }

  // Python 側は値がないとき null を返す。undefined に均しておく。
  return parsed.tracks.map((track) => ({
    ...track,
    album: track.album ?? undefined,
    durationMs: track.durationMs ?? undefined,
    artworkUrl: track.artworkUrl ?? undefined,
  }));
}

/** カタログが使えないときの代替。動画としての検索。 */
async function videoSearch(query: string, limit: number): Promise<Track[]> {
  const stdout = await run(RESOLVER_BIN, [
    `ytsearch${limit}:${query}`,
    "--dump-json",
    "--flat-playlist",
    "--no-warnings",
  ]);

  const tracks: Track[] = [];
  for (const line of stdout.split("\n")) {
    if (!line.trim()) continue;
    let entry: RawSearchEntry;
    try {
      entry = JSON.parse(line) as RawSearchEntry;
    } catch {
      continue;
    }
    if (!entry.id || !entry.title) continue;
    tracks.push({
      id: entry.id,
      sourceKind: "remote",
      sourceId: entry.id,
      title: entry.title,
      artist: entry.uploader ?? entry.channel ?? "不明",
      album: entry.album,
      durationMs: entry.duration !== undefined ? Math.round(entry.duration * 1000) : undefined,
    });
  }
  return tracks;
}

/**
 * 直接の配信 URL を得る。
 *
 * この URL をクライアントにそのまま渡さないのが重要。
 * node が受けて中継することで、CORS も Range も こちらで面倒を見られるし、
 * 供給元から見れば「その PC の持ち主が普通に取得している」ままでいられる。
 */
export async function resolveStreamUrl(sourceId: string): Promise<string> {
  const stdout = await run(RESOLVER_BIN, [
    "--format",
    "bestaudio[ext=m4a]/bestaudio",
    "--get-url",
    "--no-warnings",
    sourceId,
  ]);
  const url = stdout.trim().split("\n")[0];
  if (!url) throw new ResolverFailure({ kind: "failed", message: "配信 URL を取得できませんでした。" });
  return url;
}

/** オフライン用にファイルとして落とす。 */
export async function downloadToFile(sourceId: string, outputPath: string): Promise<void> {
  await run(
    RESOLVER_BIN,
    [
      "--format",
      "bestaudio[ext=m4a]/bestaudio",
      "--output",
      outputPath,
      "--no-warnings",
      "--no-part",
      sourceId,
    ],
    10 * 60_000,
  );
}
