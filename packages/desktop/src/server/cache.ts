import { mkdir, readdir, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { CacheEntry, CacheState } from "@musicshare/shared";
import { downloadToFile, ResolverFailure } from "./resolver.js";

/**
 * オフラインキャッシュ。
 *
 * この構成では PC が落ちている間はダウンロード済みの曲しか鳴らせないので、
 * キャッシュは「おまけ」ではなく再生経路の一部として扱う。
 */

const CACHE_DIR = join(homedir(), ".musicshare", "cache");
const entries = new Map<string, CacheEntry>();

export async function initCache(): Promise<void> {
  await mkdir(CACHE_DIR, { recursive: true });
  for (const file of await readdir(CACHE_DIR)) {
    const trackId = file.replace(/\.[^.]+$/, "");
    const info = await stat(join(CACHE_DIR, file)).catch(() => null);
    entries.set(trackId, {
      trackId,
      state: "ready",
      progress: 1,
      bytes: info?.size,
    });
  }
}

export function cachePathFor(trackId: string): string {
  return join(CACHE_DIR, `${trackId}.m4a`);
}

export function isCached(trackId: string): boolean {
  return entries.get(trackId)?.state === "ready" && existsSync(cachePathFor(trackId));
}

export function cachedCount(): number {
  return [...entries.values()].filter((e) => e.state === "ready").length;
}

export function listEntries(): CacheEntry[] {
  return [...entries.values()];
}

function setState(trackId: string, state: CacheState, patch: Partial<CacheEntry> = {}): void {
  const previous = entries.get(trackId);
  entries.set(trackId, {
    ...previous,
    ...patch,
    trackId,
    state,
    progress: patch.progress ?? (state === "ready" ? 1 : 0),
  });
}

/**
 * まとめてダウンロードする。
 * 同時に走らせすぎると供給元に不自然な負荷をかけるので、直列で流す。
 */
export async function enqueue(trackIds: string[]): Promise<void> {
  for (const trackId of trackIds) {
    if (isCached(trackId)) continue;
    setState(trackId, "queued");
  }

  for (const trackId of trackIds) {
    if (entries.get(trackId)?.state !== "queued") continue;
    setState(trackId, "downloading");
    try {
      await downloadToFile(trackId, cachePathFor(trackId));
      const info = await stat(cachePathFor(trackId)).catch(() => null);
      setState(trackId, "ready", { progress: 1, bytes: info?.size });
    } catch (error) {
      const message =
        error instanceof ResolverFailure ? error.detail.message : "ダウンロードに失敗しました。";
      setState(trackId, "failed", { error: message });
    }
  }
}
