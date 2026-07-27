import { randomUUID } from "node:crypto";
import nodeDataChannel from "node-datachannel";
import type { DataChannel, PeerConnection } from "node-datachannel";
import type { Hono } from "hono";
import {
  decodeFrameId,
  encodeFrameId,
  HUB_DEFAULT_PORT,
  PAIR_ROUTE,
  PEER_CHUNK_BYTES,
  PEER_FRAME_ID_BYTES,
  type GuestEvent,
  type HostEvent,
  type HostMessage,
  type PeerControl,
  type SignalPayload,
} from "@musicshare/shared";

/**
 * スマートフォンからの直結を受ける側。
 *
 * 中央には「合言葉をください」「相手の接続情報を渡してください」としか言わない。
 * 一度つながれば、あとはこの PC とスマートフォンの間で直接やり取りする。
 * 音声が中央を通らないのは、この経路があるから。
 *
 * 直結の上を流れるのは、ふだんの API と同じ形の要求。
 * 受け取ったらそのまま手元のサーバーに渡し、返ってきたものを送り返す。
 * こうしておけば、直結しているかどうかを他の場所が気にせずに済む。
 */

const STUN_SERVERS = ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"];

/** 送信が詰まりはじめる目安。これを超えたら流し込むのを一旦止める。 */
const BACKPRESSURE_BYTES = 1024 * 1024;

export interface PeerHostOptions {
  hubUrl?: string;
  label?: string;
  /** 合言葉が決まった / 変わったときに呼ばれる。 */
  onCode?: (code: string, expiresAt: number) => void;
  /** つながっている相手の数が変わったときに呼ばれる。 */
  onGuestCountChange?: (count: number) => void;
}

interface GuestLink {
  guestId: string;
  connection: PeerConnection;
  channel?: DataChannel;
}

export class PeerHost {
  private socket: WebSocket | null = null;
  private readonly guests = new Map<string, GuestLink>();
  private code: string | null = null;
  private closed = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly app: Hono,
    private readonly options: PeerHostOptions = {},
  ) {}

  get pairCode(): string | null {
    return this.code;
  }

  get guestCount(): number {
    return this.guests.size;
  }

  start(): void {
    this.closed = false;
    this.connect();
  }

  stop(): void {
    this.closed = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.socket?.close();
    this.socket = null;
    for (const guestId of [...this.guests.keys()]) this.dropGuest(guestId);
  }

  /* --------------------------- 中央との接続 --------------------------- */

  private connect(): void {
    const base = this.options.hubUrl ?? `http://127.0.0.1:${HUB_DEFAULT_PORT}`;
    const url = new URL(PAIR_ROUTE, base);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    url.searchParams.set("role", "host");

    const socket = new WebSocket(url.toString());
    this.socket = socket;

    socket.addEventListener("open", () => {
      // 前回と同じ合言葉を頼む。毎回変わるとスマートフォン側の登録が無駄になる。
      this.send({
        type: "host:register",
        previousCode: this.code ?? undefined,
        label: this.options.label,
      });
    });

    socket.addEventListener("message", (event) => {
      let message: HostEvent;
      try {
        message = JSON.parse(String(event.data)) as HostEvent;
      } catch {
        return;
      }
      this.handleHubEvent(message);
    });

    socket.addEventListener("close", () => {
      this.socket = null;
      this.scheduleReconnect();
    });

    socket.addEventListener("error", () => {
      // close も続けて飛ぶので、ここでは何もしない。
    });
  }

  private scheduleReconnect(): void {
    if (this.closed || this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.closed) this.connect();
    }, 5_000);
  }

  private send(message: HostMessage): void {
    if (this.socket?.readyState !== WebSocket.OPEN) return;
    this.socket.send(JSON.stringify(message));
  }

  private handleHubEvent(event: HostEvent): void {
    switch (event.type) {
      case "host:registered":
        this.code = event.code;
        this.options.onCode?.(event.code, event.expiresAt);
        return;

      case "host:guest-joined":
        this.openGuest(event.guestId);
        return;

      case "host:guest-left":
        this.dropGuest(event.guestId);
        return;

      case "host:signal":
        this.applySignal(event.guestId, event.payload);
        return;

      case "error":
        console.warn("[peer]", event.message);
        return;
    }
  }

  /* ---------------------------- 相手ごとの接続 ---------------------------- */

  private openGuest(guestId: string): void {
    this.dropGuest(guestId);

    const connection = new nodeDataChannel.PeerConnection(`guest-${guestId.slice(0, 8)}`, {
      iceServers: STUN_SERVERS,
    });
    const link: GuestLink = { guestId, connection };
    this.guests.set(guestId, link);
    this.options.onGuestCountChange?.(this.guests.size);

    connection.onLocalDescription((sdp, type) => {
      this.send({
        type: "host:signal",
        guestId,
        payload: { kind: type === "offer" ? "offer" : "answer", sdp },
      });
    });

    connection.onLocalCandidate((candidate, mid) => {
      this.send({
        type: "host:signal",
        guestId,
        payload: { kind: "candidate", candidate, mid },
      });
    });

    connection.onStateChange((state) => {
      if (state === "disconnected" || state === "failed" || state === "closed") {
        this.dropGuest(guestId);
      }
    });

    // 経路を作る側が最初の提案を出す。相手は受けて応えるだけでよくなる。
    const channel = connection.createDataChannel("api");
    link.channel = channel;
    this.wireChannel(link, channel);
  }

  private applySignal(guestId: string, payload: SignalPayload): void {
    const link = this.guests.get(guestId);
    if (!link) return;

    try {
      if (payload.kind === "answer") {
        link.connection.setRemoteDescription(payload.sdp, "answer");
      } else if (payload.kind === "offer") {
        link.connection.setRemoteDescription(payload.sdp, "offer");
      } else {
        link.connection.addRemoteCandidate(payload.candidate, payload.mid ?? "0");
      }
    } catch (error) {
      console.warn("[peer] signal error", error);
    }
  }

  private dropGuest(guestId: string): void {
    const link = this.guests.get(guestId);
    if (!link) return;
    this.guests.delete(guestId);

    try {
      link.channel?.close();
      link.connection.close();
    } catch {
      // 既に閉じている場合は気にしない。
    }
    this.options.onGuestCountChange?.(this.guests.size);
  }

  /* --------------------------- 要求の受け付け --------------------------- */

  private wireChannel(link: GuestLink, channel: DataChannel): void {
    channel.setBufferedAmountLowThreshold(BACKPRESSURE_BYTES / 2);

    channel.onMessage((data) => {
      if (typeof data !== "string") return; // 本文を送ってくることはない
      let control: PeerControl;
      try {
        control = JSON.parse(data) as PeerControl;
      } catch {
        return;
      }
      if (control.type !== "request") return;
      void this.serve(link, control);
    });
  }

  /** 受け取った要求を手元のサーバーに通し、結果を送り返す。 */
  private async serve(link: GuestLink, request: PeerControl & { type: "request" }): Promise<void> {
    const channel = link.channel;
    if (!channel) return;

    const id = request.id || randomUUID();

    try {
      const response = await this.app.fetch(
        new Request(`http://node.local${request.path}`, {
          method: request.method,
          headers: request.body ? { "Content-Type": "application/json" } : undefined,
          body: request.body ? JSON.stringify(request.body) : undefined,
        }),
      );

      const contentType = response.headers.get("content-type") ?? undefined;
      const isJson = contentType?.includes("application/json") ?? false;

      if (isJson || !response.body) {
        const json = isJson ? await response.json() : undefined;
        sendControl(channel, {
          type: "response",
          id,
          status: response.status,
          contentType,
          json,
        });
        return;
      }

      const length = Number(response.headers.get("content-length") ?? 0) || undefined;
      sendControl(channel, {
        type: "response",
        id,
        status: response.status,
        contentType,
        length,
      });

      await pumpBody(channel, id, response.body);
      sendControl(channel, { type: "chunk-end", id });
    } catch (error) {
      sendControl(channel, {
        type: "response",
        id,
        status: 500,
        error: error instanceof Error ? error.message : "処理に失敗しました。",
      });
    }
  }
}

function sendControl(channel: DataChannel, control: PeerControl): void {
  try {
    channel.sendMessage(JSON.stringify(control));
  } catch {
    // 切れた相手への送信は無視してよい。
  }
}

/**
 * 本文を刻んで流す。
 *
 * 一気に渡すと送信側に溜まって落ちるので、溜まっている量を見ながら送る。
 */
async function pumpBody(
  channel: DataChannel,
  id: string,
  body: ReadableStream<Uint8Array>,
): Promise<void> {
  const reader = body.getReader();
  const idBytes = encodeFrameId(id);

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;

      for (let offset = 0; offset < value.length; offset += PEER_CHUNK_BYTES) {
        const slice = value.subarray(offset, offset + PEER_CHUNK_BYTES);
        const frame = new Uint8Array(PEER_FRAME_ID_BYTES + slice.length);
        frame.set(idBytes, 0);
        frame.set(slice, PEER_FRAME_ID_BYTES);

        await waitForDrain(channel);
        if (!channel.isOpen()) return;
        channel.sendMessageBinary(Buffer.from(frame));
      }
    }
  } finally {
    reader.releaseLock();
  }
}

function waitForDrain(channel: DataChannel): Promise<void> {
  if (channel.bufferedAmount() < BACKPRESSURE_BYTES) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setInterval(() => {
      if (!channel.isOpen() || channel.bufferedAmount() < BACKPRESSURE_BYTES) {
        clearInterval(timer);
        resolve();
      }
    }, 20);
  });
}

/** 二値フレームから要求 ID を取り出す。受け側と対で使う。 */
export function frameIdOf(frame: Uint8Array): string {
  return decodeFrameId(frame);
}
