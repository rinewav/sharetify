import {
  decodeFrameId,
  PAIR_ROUTE,
  PEER_FRAME_ID_BYTES,
  type GuestEvent,
  type GuestMessage,
  type PeerControl,
  type PeerRequest,
} from "@sharetify/shared";
import { hubSocketUrl } from "./hub-base.js";

/**
 * 合言葉で自分の PC につなぐ側。
 *
 * 中央には合言葉を渡すだけで、そのあとのやり取りは PC と直接行う。
 * 同じネットワークに入る仕掛けを利用者に用意させずに済むのが狙い。
 *
 * 直結の上を流れるのは、ふだんの API と同じ形の要求。
 * 呼び出す側から見れば fetch とほぼ変わらないので、
 * 直結しているかどうかを気にする場所を増やさない。
 */

export type PeerStatus =
  | "idle"
  | "connecting"
  | "waiting-host"
  | "connected"
  | "failed"
  | "closed";

interface Pending {
  resolve: (value: PeerReply) => void;
  reject: (error: Error) => void;
  chunks: Uint8Array[];
  head?: { status: number; contentType?: string; json?: unknown; error?: string };
  /** 本文を待っている最中か。 */
  streaming: boolean;
}

export interface PeerReply {
  status: number;
  contentType?: string;
  json?: unknown;
  body?: Blob;
  error?: string;
}

const STUN_SERVERS = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
];

export class PeerClient {
  private socket: WebSocket | null = null;
  private connection: RTCPeerConnection | null = null;
  private channel: RTCDataChannel | null = null;
  private readonly pending = new Map<string, Pending>();
  private statusListeners = new Set<(status: PeerStatus, detail?: string) => void>();
  private status: PeerStatus = "idle";
  private requestCounter = 0;

  /*
   * 繋ぎ直しのために覚えておくもの。
   *
   * 外に持ち歩く端末では、電波が切れたり画面を消したりで
   * いつでも途切れる。そのたびに手で入れ直させるのは酷なので、
   * 黙って繋ぎ直す。
   */
  private lastCode: string | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private retryCount = 0;
  /** 利用者が自分でやめたか。やめたなら繋ぎ直さない。 */
  private stopped = false;
  /** 道ができるのを待ちきる刻限。過ぎたら諦めて繋ぎ直す。 */
  private settleTimer: ReturnType<typeof setTimeout> | null = null;

  get currentStatus(): PeerStatus {
    return this.status;
  }

  get ready(): boolean {
    return this.channel?.readyState === "open";
  }

  /**
   * いま繋いでいる相手の印。
   *
   * 相手ごとに覚えておきたいものがある側から使う。
   * 合言葉は PC ごとに決まるので、相手を見分けるのに足りる。
   */
  get peerId(): string | null {
    return this.lastCode;
  }

  /**
   * いま道を作っている最中か。
   *
   * 相手と間を取り持つ経路は、話がまとまった時点で役目を終えて閉じる。
   * だが道そのものはまだできていない。閉じたことだけを見て繋ぎ直すと、
   * その繋ぎ直しが、できかけの道を壊してしまう。
   * 何度やっても同じところで壊れるので、いつまでも繋がらない。
   */
  private get settling(): boolean {
    const state = this.connection?.connectionState;
    return state === "new" || state === "connecting";
  }

  /**
   * 待ちきる刻限を引き直す。
   *
   * 待つのは正しいが、待ち続けるのは違う。
   * 相手が黙ったまま何も起きないこともあるので、切りを付ける。
   */
  private armSettleTimeout(): void {
    if (this.settleTimer) clearTimeout(this.settleTimer);
    this.settleTimer = setTimeout(() => {
      this.settleTimer = null;
      if (this.ready || this.stopped) return;
      this.setStatus("failed", "直接つながりませんでした。");
      this.scheduleRetry();
    }, 20_000);
  }

  private disarmSettleTimeout(): void {
    if (this.settleTimer) clearTimeout(this.settleTimer);
    this.settleTimer = null;
  }

  onStatus(listener: (status: PeerStatus, detail?: string) => void): () => void {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  private setStatus(status: PeerStatus, detail?: string): void {
    this.status = status;
    for (const listener of this.statusListeners) listener(status, detail);
  }

  /**
   * 次の繋ぎ直しを仕込む。
   *
   * すぐに何度も試すと、こちらも相手も無駄に忙しくなる。
   * 失敗が続くほど間隔を空け、ただし空けすぎない。
   */
  private scheduleRetry(): void {
    if (this.stopped || !this.lastCode || this.retryTimer) return;
    // 繋がっている、あるいは繋がりかけているものを、横から壊さない。
    if (this.ready || this.settling) return;

    this.retryCount += 1;
    // 1秒から始めて、倍々にしていき、30秒で頭打ちにする。
    const waitMs = Math.min(30_000, 1000 * 2 ** Math.min(this.retryCount - 1, 5));

    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      if (this.stopped || !this.lastCode) return;
      this.connect(this.lastCode, { retry: true });
    }, waitMs);
  }

  /** 繋ぎ直しの待ちを取り消す。 */
  private cancelRetry(): void {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
  }

  /**
   * いま試し直す。
   *
   * 画面に戻ったときや電波が返ったときは、待たずに試してよい。
   * そういう場面では、たいてい繋がるようになっている。
   */
  retryNow(): void {
    if (this.stopped || !this.lastCode || this.ready) return;
    this.cancelRetry();
    this.retryCount = 0;
    this.connect(this.lastCode, { retry: true });
  }

  /** 合言葉を使って接続する。 */
  connect(code: string, options: { retry?: boolean } = {}): void {
    /*
     * 繋ぎ直しは、繋がっていないときのためのもの。
     * 繋がりかけているところに割り込むと、それを壊してやり直しになる。
     * 自分から入れ直したときだけは、望みどおり最初からやる。
     */
    if (options.retry && (this.ready || this.settling)) return;

    this.cancelRetry();
    this.close({ keepRetry: true });

    this.lastCode = code.trim().toUpperCase();
    this.stopped = false;
    // 自分から繋ぎ直したときは、数え直して間隔を戻す。
    if (!options.retry) this.retryCount = 0;

    this.setStatus("connecting");

    // 引き合わせも、普段のやり取りと同じ中央へ向かう。
    const socket = new WebSocket(hubSocketUrl(PAIR_ROUTE, { role: "guest" }));
    this.socket = socket;

    socket.addEventListener("open", () => {
      if (this.socket !== socket) return;
      this.sendSignal({ type: "guest:claim", code: code.trim().toUpperCase() });
      this.setStatus("waiting-host");
    });

    socket.addEventListener("message", (event) => {
      if (this.socket !== socket) return;
      let message: GuestEvent;
      try {
        message = JSON.parse(String(event.data)) as GuestEvent;
      } catch {
        return;
      }
      void this.handleHubEvent(message);
    });

    socket.addEventListener("close", () => {
      // 既に次を始めているなら、古いほうの終わりは関係ない。
      if (this.socket !== socket) return;
      /*
       * 引き合わせの経路が閉じただけなら、直結が生きていることもある。
       * まだ道を作っている最中のこともある。
       * どちらでもないときだけ繋ぎ直す。
       */
      if (this.ready || this.settling) return;
      this.setStatus("closed");
      this.scheduleRetry();
    });
  }

  /**
   * 経路を畳む。
   *
   * 利用者が自分でやめたときは、繋ぎ直しも止める。
   * 繋ぎ直しの途中で畳むときだけ、その段取りを残す。
   */
  close(options: { keepRetry?: boolean } = {}): void {
    this.disarmSettleTimeout();

    if (!options.keepRetry) {
      this.stopped = true;
      this.cancelRetry();
      this.lastCode = null;
    }

    for (const pending of this.pending.values()) {
      pending.reject(new Error("接続が閉じられました。"));
    }
    this.pending.clear();

    this.channel?.close();
    this.connection?.close();
    this.socket?.close();
    this.channel = null;
    this.connection = null;
    this.socket = null;
  }

  private sendSignal(message: GuestMessage): void {
    if (this.socket?.readyState !== WebSocket.OPEN) return;
    this.socket.send(JSON.stringify(message));
  }

  private async handleHubEvent(event: GuestEvent): Promise<void> {
    switch (event.type) {
      case "guest:linked":
        // PC 側が経路を作りにくるので、こちらは受け入れる準備だけしておく。
        this.prepareConnection();
        // ここから先は相手待ち。待ちきる刻限を置く。
        this.armSettleTimeout();
        return;

      case "guest:signal":
        await this.applySignal(event);
        return;

      case "guest:host-left":
        /*
         * PC が居なくなった。畳むが、繋ぎ直しの段取りは残す。
         * 立ち上げ直しただけのことも多く、じきに戻ってくる。
         */
        this.setStatus("closed", "PC 側の接続が切れました。");
        this.close({ keepRetry: true });
        this.scheduleRetry();
        return;

      case "error":
        /*
         * 合言葉の相手が見つからなかった。
         *
         * 打ち間違いのこともあるが、PC がまだ立ち上がっていないだけのことも多い。
         * 間を取り持つ経路はこのあとも開いたままなので、
         * 閉じるのを待っていると、いつまでも試し直されない。
         * ここで自分から次を仕込んでおく。間隔は失敗するほど空くので、
         * 打ち間違いのときに叩き続けることにはならない。
         */
        this.setStatus("failed", event.message);
        this.scheduleRetry();
        return;
    }
  }

  private prepareConnection(): void {
    if (this.connection) return;

    const connection = new RTCPeerConnection({ iceServers: STUN_SERVERS });
    this.connection = connection;

    connection.addEventListener("icecandidate", (event) => {
      if (!event.candidate) return;
      this.sendSignal({
        type: "guest:signal",
        payload: {
          kind: "candidate",
          candidate: event.candidate.candidate,
          mid: event.candidate.sdpMid ?? undefined,
        },
      });
    });

    connection.addEventListener("datachannel", (event) => {
      this.channel = event.channel;
      this.wireChannel(event.channel);
    });

    connection.addEventListener("connectionstatechange", () => {
      const state = connection.connectionState;
      // この繋がりが既に古いなら、その終わりに引きずられない。
      if (connection !== this.connection) return;

      if (state === "failed") {
        this.disarmSettleTimeout();
        this.setStatus("failed", "直接つながりませんでした。");
        // 電波が変わっただけのこともある。少し待って試し直す。
        this.scheduleRetry();
      } else if (state === "disconnected" || state === "closed") {
        this.disarmSettleTimeout();
        this.setStatus("closed");
        this.scheduleRetry();
      }
    });
  }

  private async applySignal(event: GuestEvent & { type: "guest:signal" }): Promise<void> {
    this.prepareConnection();
    const connection = this.connection;
    if (!connection) return;

    const payload = event.payload;
    try {
      if (payload.kind === "offer") {
        await connection.setRemoteDescription({ type: "offer", sdp: payload.sdp });
        const answer = await connection.createAnswer();
        await connection.setLocalDescription(answer);
        this.sendSignal({
          type: "guest:signal",
          payload: { kind: "answer", sdp: answer.sdp ?? "" },
        });
      } else if (payload.kind === "answer") {
        await connection.setRemoteDescription({ type: "answer", sdp: payload.sdp });
      } else {
        await connection.addIceCandidate({
          candidate: payload.candidate,
          sdpMid: payload.mid ?? "0",
        });
      }
    } catch (error) {
      console.warn("[peer] signal", error);
    }
  }

  private wireChannel(channel: RTCDataChannel): void {
    channel.binaryType = "arraybuffer";

    channel.addEventListener("open", () => {
      // つながったら数え直す。次に切れたときは、また短い間隔から試す。
      this.retryCount = 0;
      this.disarmSettleTimeout();
      this.setStatus("connected");
    });
    channel.addEventListener("close", () => {
      this.setStatus("closed");
      this.scheduleRetry();
    });

    channel.addEventListener("message", (event) => {
      if (typeof event.data === "string") {
        this.handleControl(event.data);
        return;
      }
      this.handleBinary(new Uint8Array(event.data as ArrayBuffer));
    });
  }

  private handleControl(raw: string): void {
    let control: PeerControl;
    try {
      control = JSON.parse(raw) as PeerControl;
    } catch {
      return;
    }

    const pending = this.pending.get(control.id);
    if (!pending) return;

    if (control.type === "response") {
      pending.head = {
        status: control.status,
        contentType: control.contentType,
        json: control.json,
        error: control.error,
      };
      // JSON で返ってきたなら本文は続かない。ここで確定させる。
      const hasBody = control.json === undefined && control.error === undefined;
      if (!hasBody) {
        this.pending.delete(control.id);
        pending.resolve({ ...pending.head });
        return;
      }
      pending.streaming = true;
      return;
    }

    if (control.type === "chunk-end") {
      this.pending.delete(control.id);
      const head = pending.head ?? { status: 200 };
      pending.resolve({
        ...head,
        body: new Blob(pending.chunks as BlobPart[], {
          type: head.contentType ?? "application/octet-stream",
        }),
      });
      return;
    }

    if (control.type === "abort") {
      this.pending.delete(control.id);
      pending.reject(new Error("転送が中断されました。"));
    }
  }

  private handleBinary(frame: Uint8Array): void {
    if (frame.length < PEER_FRAME_ID_BYTES) return;
    const id = decodeFrameId(frame);
    const pending = this.pending.get(id);
    if (!pending) return;
    pending.chunks.push(frame.subarray(PEER_FRAME_ID_BYTES));
  }

  /** 直結の上で要求を 1 つ投げる。 */
  request(input: Omit<PeerRequest, "id">, timeoutMs = 60_000): Promise<PeerReply> {
    const channel = this.channel;
    if (channel?.readyState !== "open") {
      return Promise.reject(new Error("自分の PC につながっていません。"));
    }

    // 応答と結びつけるための番号。固定長で二値フレームにも埋め込む。
    this.requestCounter += 1;
    const id = this.requestCounter.toString(16).padStart(PEER_FRAME_ID_BYTES * 2, "0");

    return new Promise<PeerReply>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error("応答がありませんでした。"));
      }, timeoutMs);

      this.pending.set(id, {
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
        chunks: [],
        streaming: false,
      });

      const control: PeerControl = { type: "request", id, ...input };
      channel.send(JSON.stringify(control));
    });
  }
}

export const peerClient = new PeerClient();
