import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createConnection, type Socket } from "node:net";
import { homedir, platform, tmpdir } from "node:os";
import { dirname, join } from "node:path";

/**
 * Discord に「いま聴いているもの」を出す。
 *
 * Discord は自分のプロセスと同じマシン内にソケットを開いていて、
 * そこへ JSON を投げると、プロフィールの下に表示が出る。
 * 公式のライブラリは重いうえに更新が止まりがちなので、
 * 必要な部分だけをここに書く。やり取りは 2 種類しかない。
 *
 *   1. 名乗る (HANDSHAKE)
 *   2. いま何をしているかを伝える (SET_ACTIVITY)
 *
 * Discord が起動していなければ、静かに何もしない。
 * 音楽を聴くのに Discord は要らないので、繋がらないことは失敗ではない。
 */

/** アプリの登録番号。Discord 側でこの名前とアイコンが引かれる。 */
const APPLICATION_ID = "1531259184551821352";

/** やり取りの種類。使うのはこの 3 つだけ。 */
const OP_HANDSHAKE = 0;
const OP_FRAME = 1;
const OP_CLOSE = 2;

/** 繋ぎ直しの間隔。Discord が後から起動することもある。 */
const RETRY_MS = 30_000;

/** 送る間隔の下限。Discord 側で 1 秒あたり 5 回までに制限されている。 */
const MIN_INTERVAL_MS = 3000;

export interface NowPlaying {
  title: string;
  artist: string;
  /** 出典のジャケット URL。Discord が直接取りに行くので外部の URL のまま渡す。 */
  artworkUrl?: string;
  /** 曲の長さと、いまの位置。残り時間の表示に使う。 */
  durationMs?: number;
  positionMs?: number;
  paused: boolean;
}

/** Discord のソケットの場所。OS ごとに置き場所が違う。 */
function socketPaths(): string[] {
  if (platform() === "win32") {
    return Array.from({ length: 10 }, (_, i) => `\\\\?\\pipe\\discord-ipc-${i}`);
  }

  /*
   * Unix 系では一時ディレクトリの下にある。
   * Flatpak や Snap で入れると一段深いところに置かれるので、そこも見る。
   */
  const base =
    process.env["XDG_RUNTIME_DIR"] ??
    process.env["TMPDIR"] ??
    process.env["TMP"] ??
    tmpdir();

  const roots = [
    base,
    join(base, "app", "com.discordapp.Discord"),
    join(base, "snap.discord"),
    join(homedir(), ".config", "discord"),
  ];

  return roots.flatMap((root) =>
    Array.from({ length: 10 }, (_, i) => join(root, `discord-ipc-${i}`)),
  );
}

/** 1 つの用件を組み立てる。頭に種類と長さを付けた JSON。 */
function encode(op: number, payload: unknown): Buffer {
  const body = Buffer.from(JSON.stringify(payload), "utf8");
  const head = Buffer.alloc(8);
  head.writeInt32LE(op, 0);
  head.writeInt32LE(body.length, 4);
  return Buffer.concat([head, body]);
}

/* --------------------------- 設定の保存 --------------------------- */

const CONFIG_PATH = join(homedir(), ".sharetify", "discord.json");

interface Config {
  enabled?: boolean;
}

let config: Config = {};

export async function loadDiscordConfig(): Promise<void> {
  try {
    config = JSON.parse(await readFile(CONFIG_PATH, "utf8")) as Config;
  } catch {
    // まだ決めていない。既定は使わない。
    config = {};
  }
}

export function discordEnabled(): boolean {
  return config.enabled === true;
}

export async function setDiscordEnabled(enabled: boolean): Promise<void> {
  config = { ...config, enabled };
  await mkdir(dirname(CONFIG_PATH), { recursive: true });
  await writeFile(CONFIG_PATH, JSON.stringify(config, null, 2), "utf8");
}

export class DiscordPresence {
  private socket: Socket | null = null;
  private connected = false;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;

  /** 最後に送った内容と時刻。同じものを送り直さないために持つ。 */
  private lastKey = "";
  private lastSentAt = 0;
  /** 間隔を空けている間に届いた、いちばん新しい内容。 */
  private queued: NowPlaying | null = null;
  private flushTimer: ReturnType<typeof setTimeout> | null = null;

  start(): void {
    this.stopped = false;
    void this.connect();
  }

  stop(): void {
    this.stopped = true;
    this.cancelRetry();
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = null;
    this.disconnect();
  }

  get ready(): boolean {
    return this.connected;
  }

  /* --------------------------- 繋ぐ --------------------------- */

  private async connect(): Promise<void> {
    if (this.stopped || this.socket) return;

    for (const path of socketPaths()) {
      const socket = await this.tryPath(path);
      if (!socket) continue;

      this.socket = socket;
      this.wire(socket);
      socket.write(encode(OP_HANDSHAKE, { v: 1, client_id: APPLICATION_ID }));
      return;
    }

    // どこにも居なかった。Discord が起動していないだけのことが多い。
    this.scheduleRetry();
  }

  /** その場所に繋がるか試す。繋がらなければ null。 */
  private tryPath(path: string): Promise<Socket | null> {
    return new Promise((resolve) => {
      const socket = createConnection(path);
      const give = () => {
        socket.removeAllListeners();
        socket.destroy();
        resolve(null);
      };
      socket.once("connect", () => {
        socket.removeAllListeners("error");
        resolve(socket);
      });
      socket.once("error", give);
      socket.setTimeout(1000, give);
    });
  }

  private wire(socket: Socket): void {
    socket.setTimeout(0);

    let buffer = Buffer.alloc(0);
    socket.on("data", (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);

      // 頭の 8 バイトに種類と長さが入っている。揃うまで待つ。
      while (buffer.length >= 8) {
        const op = buffer.readInt32LE(0);
        const length = buffer.readInt32LE(4);
        if (buffer.length < 8 + length) break;

        const body = buffer.subarray(8, 8 + length).toString("utf8");
        buffer = buffer.subarray(8 + length);
        this.handle(op, body);
      }
    });

    const drop = () => {
      if (this.socket !== socket) return;
      this.connected = false;
      this.socket = null;
      this.scheduleRetry();
    };
    socket.on("close", drop);
    socket.on("error", drop);
    socket.on("end", drop);
  }

  private handle(op: number, body: string): void {
    if (op === OP_CLOSE) {
      this.disconnect();
      this.scheduleRetry();
      return;
    }
    if (op !== OP_FRAME) return;

    try {
      const message = JSON.parse(body) as {
        evt?: string;
        data?: { message?: string; code?: number };
      };

      if (message.evt === "READY") {
        this.connected = true;
        console.log("[discord] 接続しました");
        // 待たせていたものがあれば、ここで出す。
        if (this.queued) this.flush();
        return;
      }

      /*
       * 受け付けられなかったとき。
       *
       * 黙って捨てると「オンにしたのに出ない」だけが残り、
       * どこが悪いのか分からなくなる。理由をそのまま出す。
       */
      if (message.evt === "ERROR") {
        console.warn(
          `[discord] 表示できませんでした: ${message.data?.message ?? "理由不明"}`,
        );
      }
    } catch {
      // 読めないものが来ても、こちらから壊すことはない。
    }
  }

  private disconnect(): void {
    this.connected = false;
    const socket = this.socket;
    this.socket = null;
    if (!socket) return;
    socket.removeAllListeners();
    socket.destroy();
  }

  private scheduleRetry(): void {
    if (this.stopped || this.retryTimer) return;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      void this.connect();
    }, RETRY_MS);
  }

  private cancelRetry(): void {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
  }

  /* --------------------------- 伝える --------------------------- */

  /**
   * いま聴いているものを伝える。
   *
   * 曲が変わるたびに呼ばれるが、Discord 側に送れる回数には上限がある。
   * 間隔が空いていなければ持ち越して、空いてから最新のものだけを送る。
   */
  update(playing: NowPlaying | null): void {
    if (playing === null) {
      this.queued = null;
      this.lastKey = "";
      this.send(null);
      return;
    }

    this.queued = playing;

    const waited = Date.now() - this.lastSentAt;
    if (waited >= MIN_INTERVAL_MS) {
      this.flush();
      return;
    }

    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      this.flush();
    }, MIN_INTERVAL_MS - waited);
  }

  private flush(): void {
    const playing = this.queued;
    if (!playing) return;

    /*
     * 同じ内容なら送らない。
     *
     * 再生位置は絶えず動くが、Discord に出るのは終わる時刻なので、
     * 曲と再生状態が同じなら送り直す意味がない。
     */
    const key = `${playing.title}|${playing.artist}|${playing.paused}`;
    if (key === this.lastKey) return;

    this.lastKey = key;
    this.lastSentAt = Date.now();
    this.send(playing);
  }

  private send(playing: NowPlaying | null): void {
    if (!this.connected || !this.socket) return;

    try {
      this.socket.write(
        encode(OP_FRAME, {
          cmd: "SET_ACTIVITY",
          nonce: randomUUID(),
          args: {
            pid: process.pid,
            activity: playing ? activityFor(playing) : undefined,
          },
        }),
      );
    } catch {
      // 書けなければ切れている。close が来て繋ぎ直しに入る。
    }
  }
}

/** Discord に渡す形に整える。 */
function activityFor(playing: NowPlaying): Record<string, unknown> {
  /*
   * 表示は 2 文字以上でないと弾かれる。
   * 短い曲名やアーティスト名があるので、足りなければ空白で埋める。
   */
  const pad = (value: string) => (value.length >= 2 ? value : `${value} `);

  const activity: Record<string, unknown> = {
    // 2 は「音楽を聴いている」の意。
    type: 2,
    details: pad(playing.title).slice(0, 128),
    state: pad(playing.artist).slice(0, 128),
    assets: {
      large_image: playing.artworkUrl ?? "logo",
      large_text: pad(playing.title).slice(0, 128),
      small_image: playing.paused ? "paused" : "playing",
      small_text: playing.paused ? "一時停止中" : "再生中",
    },
  };

  /*
   * 流れている間だけ、終わる時刻を添える。
   * これがあると Discord 側が残り時間を数えてくれる。
   * 止まっているときに添えると、止めたまま時間だけ進んでしまう。
   */
  if (!playing.paused && playing.durationMs && playing.durationMs > 0) {
    const now = Date.now();
    const start = now - (playing.positionMs ?? 0);
    activity["timestamps"] = { start, end: start + playing.durationMs };
  }

  return activity;
}
