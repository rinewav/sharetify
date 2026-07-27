import { randomBytes, randomUUID } from "node:crypto";
import type { WSContext } from "hono/ws";
import {
  PAIR_CODE_LENGTH,
  PAIR_CODE_TTL_MS,
  type GuestEvent,
  type GuestMessage,
  type HostEvent,
  type HostMessage,
} from "@sharetify/shared";

/**
 * 引き合わせ役。
 *
 * ここで扱うのは「どの PC とどのスマートフォンを繋ぐか」だけ。
 * 接続情報は中身を見ずにそのまま相手へ渡す。
 * 直結できたあとの通信はここを通らないので、
 * 利用者が増えても中央の負荷はほとんど変わらない。
 */

interface Host {
  id: string;
  code: string;
  expiresAt: number;
  label?: string;
  socket: WSContext;
  guestIds: Set<string>;
}

interface Guest {
  id: string;
  hostId?: string;
  socket: WSContext;
}

const hostsById = new Map<string, Host>();
const hostsByCode = new Map<string, Host>();
const guestsById = new Map<string, Guest>();

/**
 * 誰がその合言葉を使っていたか。
 *
 * PC を閉じて開き直すと、同じ合言葉を名乗り直してくる。
 * そのとき、前に使っていたのと同じ相手かどうかを見分けたい。
 * 見分けないと、別の PC が先に名乗って横取りできてしまう。
 *
 * 覚えているのは名乗りの印だけで、誰が何を聴いているかは持たない。
 */
const codeOwners = new Map<string, string>();

/** 名乗りの印を保つ日数。長く使っていない合言葉は手放す。 */
const OWNER_TTL_MS = 90 * 24 * 60 * 60_000;
const ownerSeenAt = new Map<string, number>();

/** 紛らわしい文字を外した英数字。電話越しに読み上げても取り違えない。 */
const CODE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";

function generateCode(): string {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const bytes = randomBytes(PAIR_CODE_LENGTH);
    let code = "";
    for (let i = 0; i < PAIR_CODE_LENGTH; i += 1) {
      code += CODE_ALPHABET[bytes[i]! % CODE_ALPHABET.length];
    }
    if (!hostsByCode.has(code)) return code;
  }
  // ここまで外れることは実質ないが、万一のときは重複しない値に逃がす。
  return randomUUID().replace(/-/g, "").slice(0, PAIR_CODE_LENGTH).toUpperCase();
}

function dropExpired(): void {
  const now = Date.now();
  for (const [code, host] of hostsByCode) {
    // 相手がついている間は期限で切らない。合言葉の再利用だけを止める。
    if (host.expiresAt < now && host.guestIds.size === 0) {
      hostsByCode.delete(code);
    }
  }
}

/** 長く使われていない名乗りの印を手放す。 */
function dropStaleOwners(): void {
  const now = Date.now();
  for (const [code, seenAt] of ownerSeenAt) {
    if (now - seenAt < OWNER_TTL_MS) continue;
    ownerSeenAt.delete(code);
    codeOwners.delete(code);
  }
}

/* ------------------------------- PC 側 ------------------------------- */

export function openHost(socket: WSContext): string {
  const id = randomUUID();
  hostsById.set(id, {
    id,
    code: "",
    expiresAt: 0,
    socket,
    guestIds: new Set(),
  });
  return id;
}

export function handleHostMessage(hostId: string, raw: string): void {
  const host = hostsById.get(hostId);
  if (!host) return;

  let message: HostMessage;
  try {
    message = JSON.parse(raw) as HostMessage;
  } catch {
    sendHost(host, { type: "error", message: "malformed message" });
    return;
  }

  switch (message.type) {
    case "host:register": {
      dropExpired();
      dropStaleOwners();
      if (host.code) hostsByCode.delete(host.code);

      /*
       * 一度知らせた合言葉は、使い続けられるようにする。
       * 閉じて開くたびに変わると、スマホ側の覚えが無駄になる。
       *
       * ただし誰でも名乗れてはいけない。前に使っていた相手だけが
       * 名乗り直せるよう、名乗りの印を照らし合わせる。
       */
      const wanted = message.previousCode?.toUpperCase();
      const identity = message.identity;

      const claimable =
        wanted !== undefined &&
        !hostsByCode.has(wanted) &&
        // 誰のものでもないか、前と同じ相手なら名乗れる。
        (!codeOwners.has(wanted) || codeOwners.get(wanted) === identity);

      const code = claimable ? wanted : generateCode();

      if (identity) {
        codeOwners.set(code, identity);
        ownerSeenAt.set(code, Date.now());
      }

      host.code = code;
      host.label = message.label;
      host.expiresAt = Date.now() + PAIR_CODE_TTL_MS;
      hostsByCode.set(code, host);

      sendHost(host, { type: "host:registered", code, expiresAt: host.expiresAt });
      return;
    }

    case "host:signal": {
      const guest = guestsById.get(message.guestId);
      if (!guest || guest.hostId !== host.id) return;
      sendGuest(guest, { type: "guest:signal", payload: message.payload });
      return;
    }
  }
}

export function closeHost(hostId: string): void {
  const host = hostsById.get(hostId);
  if (!host) return;

  hostsById.delete(hostId);
  if (host.code) hostsByCode.delete(host.code);

  for (const guestId of host.guestIds) {
    const guest = guestsById.get(guestId);
    if (!guest) continue;
    guest.hostId = undefined;
    sendGuest(guest, { type: "guest:host-left" });
  }
}

/* ---------------------------- スマートフォン側 ---------------------------- */

export function openGuest(socket: WSContext): string {
  const id = randomUUID();
  guestsById.set(id, { id, socket });
  return id;
}

export function handleGuestMessage(guestId: string, raw: string): void {
  const guest = guestsById.get(guestId);
  if (!guest) return;

  let message: GuestMessage;
  try {
    message = JSON.parse(raw) as GuestMessage;
  } catch {
    sendGuest(guest, { type: "error", message: "malformed message" });
    return;
  }

  switch (message.type) {
    case "guest:claim": {
      dropExpired();
      const host = hostsByCode.get(message.code.trim().toUpperCase());
      if (!host) {
        sendGuest(guest, { type: "error", message: "合言葉が違うか、期限切れです。" });
        return;
      }

      guest.hostId = host.id;
      host.guestIds.add(guest.id);

      sendGuest(guest, { type: "guest:linked", hostLabel: host.label });
      sendHost(host, { type: "host:guest-joined", guestId: guest.id });
      return;
    }

    case "guest:signal": {
      const host = guest.hostId ? hostsById.get(guest.hostId) : undefined;
      if (!host) {
        sendGuest(guest, { type: "error", message: "まだ接続先が決まっていません。" });
        return;
      }
      sendHost(host, { type: "host:signal", guestId: guest.id, payload: message.payload });
      return;
    }
  }
}

export function closeGuest(guestId: string): void {
  const guest = guestsById.get(guestId);
  if (!guest) return;

  guestsById.delete(guestId);
  const host = guest.hostId ? hostsById.get(guest.hostId) : undefined;
  if (!host) return;

  host.guestIds.delete(guestId);
  sendHost(host, { type: "host:guest-left", guestId });
}

/* -------------------------------- 送信 -------------------------------- */

function sendHost(host: Host, event: HostEvent): void {
  trySend(host.socket, event);
}

function sendGuest(guest: Guest, event: GuestEvent): void {
  trySend(guest.socket, event);
}

function trySend(socket: WSContext, payload: unknown): void {
  try {
    socket.send(JSON.stringify(payload));
  } catch {
    // 切れた相手への送信は無視してよい。close で片付く。
  }
}

/** 監視用。 */
export function pairingStats(): { hosts: number; guests: number } {
  return { hosts: hostsById.size, guests: guestsById.size };
}
