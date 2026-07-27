import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { HistoryEntry } from "@sharetify/shared";

/**
 * 聴いた跡を、この PC で預かる。
 *
 * 端末は替わるし、覚えているものを消すこともある。
 * PC のほうが長生きするので、寄せ集める場所はこちらに置く。
 * 電話で聴いたものが PC のおすすめに効き、その逆も効くようになる。
 *
 * ここに置いたものは、この機械と、この機械に繋いだ端末の間しか行き来しない。
 * 中央サーバーへは送らない。誰が何を聴いたかを外に出さないための線引きで、
 * ここが崩れると設計の前提が変わる。
 */

const HISTORY_PATH = join(homedir(), ".sharetify", "history.json");

/**
 * 残す件数。古いものから落とす。
 *
 * 端末側より多く持たせる。集める側なので、複数の端末ぶんが入る。
 */
const MAX_ENTRIES = 20_000;

/** 初めての端末に渡す件数。全部渡すと、繋いだ直後に詰まる。 */
const FIRST_BATCH = 3000;

/**
 * 預かったものと、預かった順。
 *
 * 「いつ聴いたか」と「いつこちらに届いたか」は順番が一致しない。
 * 別の端末が、あとから古い跡を持ってくることがあるからで、
 * 聴いた時刻だけで数えると、それを取りこぼす。
 */
interface Held {
  entry: HistoryEntry;
  /** 預かった順。増える一方の番号。 */
  seq: number;
}

let held: Held[] = [];
let nextSeq = 1;
let loaded = false;

/**
 * この預かり場の代。
 *
 * 置き場ごと消えると番号は 1 から振り直される。
 * 端末が前の代の印を握ったままだと、同じ番号で別のものを数えることになり、
 * そのぶんを取りこぼす。代を添えておけば、端末が気づいて受け取り直せる。
 */
let origin = "";

/**
 * 同じ一回を指す印。
 *
 * 曲だけでは足りない。同じ曲を二度聴けば二回ぶんある。
 * 時刻を合わせて見るが、端末と PC で時計がぴったり同じとは限らないので、
 * 秒より細かいところは切り捨てる。同じ曲を同じ秒に二度は始められない。
 */
function keyOf(entry: HistoryEntry): string {
  return `${entry.track.id}@${Math.floor(entry.playedAt / 1000)}`;
}

/** 形が合っているか。よそから届くものなので、通す前に見る。 */
function isValid(value: unknown): value is HistoryEntry {
  if (typeof value !== "object" || value === null) return false;
  const entry = value as Partial<HistoryEntry>;
  if (typeof entry.playedAt !== "number" || !Number.isFinite(entry.playedAt)) return false;
  if (typeof entry.playedMs !== "number" || !Number.isFinite(entry.playedMs)) return false;
  const track = entry.track as Partial<HistoryEntry["track"]> | undefined;
  return typeof track?.id === "string" && typeof track.title === "string";
}

interface Stored {
  origin: string;
  held: Held[];
}

export async function loadHistory(): Promise<void> {
  if (loaded) return;
  try {
    const raw = JSON.parse(await readFile(HISTORY_PATH, "utf8")) as Partial<Stored>;
    const list = Array.isArray(raw.held) ? raw.held : [];
    held = list
      .filter((row): row is Held => {
        if (typeof row !== "object" || row === null) return false;
        const candidate = row as Partial<Held>;
        return typeof candidate.seq === "number" && isValid(candidate.entry);
      })
      .map((row) => ({ entry: row.entry, seq: row.seq }));
    nextSeq = held.reduce((max, row) => Math.max(max, row.seq), 0) + 1;
    origin = typeof raw.origin === "string" && raw.origin ? raw.origin : randomUUID();
  } catch {
    // 読めない、あるいはまだ無い。ここから新しい代が始まる。
    held = [];
    nextSeq = 1;
    origin = randomUUID();
  }
  loaded = true;
}

/**
 * 書き出す。
 *
 * いきなり本体へ書くと、途中で電源が落ちたときに読めないものが残る。
 * 別の名前で書ききってから置き換えれば、どちらかの状態しか現れない。
 */
async function persist(): Promise<void> {
  const temporary = `${HISTORY_PATH}.writing`;
  const stored: Stored = { origin, held };
  await mkdir(dirname(HISTORY_PATH), { recursive: true });
  await writeFile(temporary, JSON.stringify(stored), "utf8");
  await rename(temporary, HISTORY_PATH);
}

/** 書き出しをまとめる。続けて届いたときに、そのたび書かない。 */
let pending: ReturnType<typeof setTimeout> | null = null;

function persistSoon(): void {
  if (pending) return;
  pending = setTimeout(() => {
    pending = null;
    void persist().catch(() => {
      // 残せなくても、聴くことそのものは続けられる。
    });
  }, 1000);
}

/** 覚えているものすべて。新しく聴いた順。 */
export function listHistory(): HistoryEntry[] {
  return [...held].sort((a, b) => b.entry.playedAt - a.entry.playedAt).map((row) => row.entry);
}

/**
 * 端末がまだ知らないぶん。
 *
 * 印より後に預かったものを返す。初めての端末には直近をまとめて渡す。
 */
export function historySince(since?: number): HistoryEntry[] {
  const rows =
    since === undefined
      ? [...held].sort((a, b) => b.entry.playedAt - a.entry.playedAt).slice(0, FIRST_BATCH)
      : held.filter((row) => row.seq > since).sort((a, b) => b.entry.playedAt - a.entry.playedAt);
  return rows.map((row) => row.entry);
}

/** 次に渡す印。ここまで預かった、という目印になる。 */
export function historyCursor(): number {
  return nextSeq - 1;
}

/** この預かり場の代。作り直されたことを端末に気づかせる。 */
export function historyOrigin(): string {
  return origin;
}

export function historyCount(): number {
  return held.length;
}

/**
 * 届いた跡を寄せ合わせる。
 *
 * 同じ一回を二度数えない。端末は繋ぐたびに手持ちを差し出すので、
 * 重なりは必ず出る。数え直すと、聴いた回数が繋いだ回数だけ増えてしまう。
 */
export function mergeHistory(incoming: unknown[]): number {
  const known = new Set(held.map((row) => keyOf(row.entry)));
  const fresh: Held[] = [];

  for (const candidate of incoming) {
    if (!isValid(candidate)) continue;
    const key = keyOf(candidate);
    if (known.has(key)) continue;
    known.add(key);
    fresh.push({ entry: candidate, seq: nextSeq });
    nextSeq += 1;
  }

  if (fresh.length === 0) return 0;

  /*
   * 溢れたら、古く聴いたものから落とす。
   * 預かった順ではなく聴いた順で落とすのは、
   * 新しく聴いたものほど、おすすめに効くから。
   */
  held = [...held, ...fresh];
  if (held.length > MAX_ENTRIES) {
    held = [...held]
      .sort((a, b) => b.entry.playedAt - a.entry.playedAt)
      .slice(0, MAX_ENTRIES);
  }

  persistSoon();
  return fresh.length;
}

/** 預かっているものを捨てる。端末側で消したときに、こちらも合わせる。 */
export async function clearHistory(): Promise<void> {
  held = [];
  /*
   * 番号は戻さない。戻すと、印を持ったままの端末が
   * 「まだ知らないぶん」を取りこぼす。
   */
  await persist().catch(() => undefined);
}
