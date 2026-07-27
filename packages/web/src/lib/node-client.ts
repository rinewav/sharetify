import type {
  CacheStatusResponse,
  CollectionKind,
  CollectionResponse,
  DiscoverResponse,
  HistoryEntry,
  HistoryMergeResponse,
  ImportedEntry,
  LyricsResult,
  NodeHealth,
  PlaylistImportResponse,
  PlaylistMatchResponse,
  PresenceStatus,
  RadioResponse,
  ResolveResponse,
  SearchResponse,
  Track,
} from "@sharetify/shared";
import { HUB_BASE } from "./hub-base.js";
import { peerClient } from "./peer-client.js";
import { isDesktopApp } from "./platform.js";

/**
 * 自分の PC 上の node への接続。
 *
 * 経路は 2 つあり、呼び出す側はどちらかを意識しない。
 *
 *   1. 直結 — 合言葉でつないだ場合。中央を通らず PC と直接やり取りする
 *   2. 同一オリジンへの中継 — 同じネットワークにいる場合の開発用
 *
 * 中継のほうを使うとき、外部の URL をブラウザから直接叩かせないのが要点。
 * スマートフォンからは HTTPS で入ってくるので、
 * HTTP の node を直に触ると混在コンテンツで弾かれる。
 */

/*
 * 自分の PC への入口。
 *
 * 開発中は別に立てた配信役が取り次ぐので、その道を通る。
 * 配って回すものは画面と同じ所から配られているので、付け足す道は要らない。
 * 空を指定できるようにしておかないと、存在しない道を叩き続けることになる。
 */
const configuredBase = import.meta.env["VITE_NODE_BASE"];
const BASE = configuredBase === undefined ? "/node-api" : configuredBase;

/** 直結が使える状態か。 */
function viaPeer(): boolean {
  return peerClient.ready;
}

/**
 * 自分の PC へ、直に叩ける道があるか。
 *
 * 開発中は取り次ぐ役がいる。入れ物の中では仕組みが同じ所にいる。
 * どちらでもない、中央から配られた画面には、この道が無い。
 * 無いのにその道を使うと、中央が画面を返し、それを音や絵として
 * 読もうとして倒れる。行き先の有無は、ここ一箇所で判ずる。
 */
function hasDirectRoute(): boolean {
  return BASE !== "" || isDesktopApp();
}

/**
 * いま自分の PC に用が届くか。
 *
 * 繋いだ先にいることもあれば、同じ場所にいることもある。
 * 呼ぶ側から見れば、届くかどうかだけが分かればよい。
 */
export function canReachNode(): boolean {
  return viaPeer() || hasDirectRoute();
}

/**
 * 用の届く先を見分ける印。
 *
 * 相手ごとに覚えておきたいものがある側から使う。
 * 合言葉は PC ごとに決まるので、繋いだ先を見分けるのに足りる。
 * 同じ場所にいるなら、相手は常に自分自身なので固定の名前でよい。
 */
export function nodeIdentity(): string | null {
  if (viaPeer()) return peerClient.peerId ?? "peer";
  return hasDirectRoute() ? "local" : null;
}

/**
 * つないでいないのに投げていないか。
 *
 * 直結が要る作りなのに繋がっていないと、要求は行き場を失う。
 * 中央から配られた画面では、行き先が画面と同じ所になるので、
 * 中央が画面を返し、それを中身として読もうとして意味の分からない形で失敗する。
 * 先に断っておけば、何が足りないのかがそのまま伝わる。
 */
function assertReachable(): void {
  if (viaPeer() || hasDirectRoute()) return;
  throw new Error("自分の PC につながっていません。合言葉でつないでください。");
}

async function getJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  if (viaPeer()) {
    const reply = await peerClient.request({ method: "GET", path });
    if (reply.error) throw new Error(reply.error);
    if (reply.status >= 400) {
      throw new Error(describeStatus(reply.status, reply.json));
    }
    return reply.json as T;
  }

  assertReachable();

  const response = await fetch(`${BASE}${path}`, { signal });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `リクエストに失敗しました (${response.status})`);
  }

  /*
   * 中身の種類を確かめてから読む。
   *
   * 行き先を取り違えていると、画面がそのまま返ってくることがある。
   * それを中身として読もうとすると、閲覧環境ごとに違う言い回しで倒れる
   * (iOS では「The string did not match the expected pattern」)。
   */
  const type = response.headers.get("content-type") ?? "";
  if (!type.includes("json")) {
    throw new Error("自分の PC につながっていません。合言葉でつないでください。");
  }
  return (await response.json()) as T;
}

function describeStatus(status: number, json: unknown): string {
  const message = (json as { error?: string } | undefined)?.error;
  return message ?? `リクエストに失敗しました (${status})`;
}

export function nodeHealth(signal?: AbortSignal): Promise<NodeHealth> {
  return getJson<NodeHealth>("/api/health", signal);
}

export function nodeSearch(query: string, limit = 20, signal?: AbortSignal) {
  const params = new URLSearchParams({ q: query, limit: String(limit) });
  return getJson<SearchResponse>(`/api/search?${params}`, signal);
}

/** アルバム・プレイリスト・アーティストを開く。 */
export function nodeCollection(kind: CollectionKind, id: string, signal?: AbortSignal) {
  const params = new URLSearchParams({ kind, id });
  return getJson<CollectionResponse>(`/api/collection?${params}`, signal);
}

export function nodeResolve(trackId: string, signal?: AbortSignal) {
  const params = new URLSearchParams({ trackId });
  return getJson<ResolveResponse>(`/api/resolve?${params}`, signal);
}

export function nodeCacheStatus(signal?: AbortSignal) {
  return getJson<CacheStatusResponse>("/api/cache/status", signal);
}

export async function nodeCache(trackIds: string[]): Promise<void> {
  if (viaPeer()) {
    await peerClient.request({ method: "POST", path: "/api/cache", body: { trackIds } });
    return;
  }
  assertReachable();
  await fetch(`${BASE}/api/cache`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ trackIds }),
  });
}

/**
 * 再生に渡す URL。
 *
 * 中継経路なら node の URL をそのまま使えるので、範囲指定も追い読みも効く。
 * 直結の場合は一度受け取りきってから渡す。
 * 受け取り終えるまで音は出せないが、そのぶん途中の飛び先も自由になる。
 */
export function streamUrl(trackId: string): string {
  return `${BASE}/api/stream?trackId=${encodeURIComponent(trackId)}`;
}

/**
 * 音を URL のまま渡してよいか。
 *
 * 渡せるのは、その URL を閲覧環境が自分で取りに行ける時だけ。
 * 直結しかない場では取りに行く先が無いので、先に受け取ってから渡す。
 */
export function canStreamDirectly(): boolean {
  if (viaPeer()) return false;
  return hasDirectRoute();
}

/** 直結のときに、曲を受け取って再生できる形にする。 */
export async function fetchTrackBlob(trackId: string): Promise<{ url: string; blob: Blob }> {
  /*
   * 繋がっていないまま頼むと、返事の来ない待ちに入る。
   * 待たせたあげく黙って終わるより、足りないものを先に言う。
   */
  if (!viaPeer()) throw new Error("自分の PC につながっていません。合言葉でつないでください。");

  const reply = await peerClient.request(
    { method: "GET", path: `/api/stream?trackId=${encodeURIComponent(trackId)}`, binary: true },
    5 * 60_000,
  );
  if (reply.error) throw new Error(reply.error);
  if (!reply.body) throw new Error("音声を受け取れませんでした。");
  return { url: URL.createObjectURL(reply.body), blob: reply.body };
}

/**
 * 端末に残すために取ってくる。
 * 経路がどちらでも同じように扱えるよう、ここで吸収する。
 */
export async function fetchTrackForOffline(trackId: string): Promise<Blob> {
  if (viaPeer()) {
    const { url, blob } = await fetchTrackBlob(trackId);
    URL.revokeObjectURL(url);
    return blob;
  }
  const response = await fetch(streamUrl(trackId));
  if (!response.ok) throw new Error("曲を取得できませんでした。");
  return await response.blob();
}

/** ある曲を種に、続けて流す曲を並べる。おすすめの主役。 */
export function nodeRadio(trackId: string, limit = 25, signal?: AbortSignal) {
  const params = new URLSearchParams({ trackId, limit: String(limit) });
  return getJson<RadioResponse>(`/api/radio?${params}`, signal);
}

/** 地域向けの汎用のおすすめ。 */
export function nodeDiscover(signal?: AbortSignal) {
  return getJson<DiscoverResponse>("/api/discover", signal);
}

/** 歌詞を探す。時刻付きが見つかれば再生に合わせて送れる。 */
export function nodeLyrics(track: Track, signal?: AbortSignal): Promise<LyricsResult> {
  const params = new URLSearchParams({
    trackId: track.id,
    title: track.title,
    artist: track.artist,
  });
  if (track.album) params.set("album", track.album);
  if (track.durationMs) params.set("durationMs", String(track.durationMs));
  return getJson<LyricsResult>(`/api/lyrics?${params}`, signal);
}

/* ------------------------------ 道具立て ------------------------------ */

export interface ToolchainStatus {
  /** そのまま使える状態か。 */
  ready: boolean;
  /** 曲の情報を引く仕掛けが使えるか。 */
  catalog: boolean;
  /** 音を取ってくる仕掛けが使えるか。 */
  resolver: boolean;
  message?: string;
}

export function nodeToolchain(signal?: AbortSignal): Promise<ToolchainStatus> {
  return getJson<ToolchainStatus>("/api/toolchain", signal);
}

export interface InstallStep {
  step?: string;
  detail?: string;
  done?: boolean;
  error?: string;
  status?: ToolchainStatus;
}

/**
 * 足りないものを入れる。
 *
 * 時間がかかるので、進み具合を受け取りながら待つ。
 * 黙って待たせると、止まっているのか進んでいるのか分からない。
 */
export async function nodeInstallToolchain(
  onStep: (step: InstallStep) => void,
): Promise<ToolchainStatus> {
  const response = await fetch(`${BASE}/api/toolchain/install`, { method: "POST" });
  if (!response.body) throw new Error("進み具合を受け取れませんでした。");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let result: ToolchainStatus | null = null;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    // 行ごとに区切られて届く。最後の切れ端は次に持ち越す。
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (!line.trim()) continue;
      const payload = JSON.parse(line) as InstallStep;
      onStep(payload);
      if (payload.error) throw new Error(payload.error);
      if (payload.status) result = payload.status;
    }
  }

  if (!result) throw new Error("うまく整いませんでした。");
  return result;
}

/** 音を取ってくる仕掛けだけを新しくする。 */
export function nodeUpdateResolver(): Promise<ToolchainStatus> {
  return post<ToolchainStatus>("/api/toolchain/update");
}

/* ------------------------------ 聴いた跡 ------------------------------ */

/**
 * 手持ちの跡を PC に預け、まだ知らないぶんを受け取る。
 *
 * 行き来するのは、この端末と自分の PC の間だけ。中央は通らない。
 */
export function nodeMergeHistory(
  entries: HistoryEntry[],
  mark?: { since: number; origin: string },
): Promise<HistoryMergeResponse> {
  return post<HistoryMergeResponse>("/api/history/merge", {
    entries,
    ...(mark ?? {}),
  });
}

/** PC が預かっているものを捨てる。端末側で消したときに合わせる。 */
export function nodeClearHistory(): Promise<HistoryMergeResponse> {
  return post<HistoryMergeResponse>("/api/history/clear");
}

/* --------------------------- Discord への表示 --------------------------- */

export function presenceStatus(): Promise<PresenceStatus> {
  return getJson<PresenceStatus>("/api/presence");
}

export function setPresenceEnabled(enabled: boolean): Promise<PresenceStatus> {
  return post<PresenceStatus>("/api/presence", { enabled });
}

/** いま聴いているものを伝える。何も聴いていなければ null。 */
export function reportPresence(
  track: { title: string; artist: string; artworkUrl?: string; durationMs?: number } | null,
  positionMs?: number,
  paused?: boolean,
): Promise<PresenceStatus> {
  return post<PresenceStatus>("/api/presence", { track, positionMs, paused });
}

/* ------------------------------ 迎える側 ------------------------------ */

export interface PairingStatus {
  /** スマホに渡す合言葉。まだ決まっていなければ null。 */
  code: string | null;
  /** いま繋がっている端末の数。 */
  guests: number;
  /** 迎え入れる用意ができているか。 */
  enabled: boolean;
}

/** この PC が迎える側として、いまどうなっているか。 */
export function nodePairingStatus(signal?: AbortSignal): Promise<PairingStatus> {
  return getJson<PairingStatus>("/api/pairing", signal);
}

/* ------------------------------ 聴取記録 ------------------------------ */

export interface LastfmStatus {
  configured: boolean;
  connected: boolean;
  username?: string;
}

async function post<T>(path: string, body?: unknown): Promise<T> {
  if (viaPeer()) {
    const reply = await peerClient.request({ method: "POST", path, body });
    if (reply.error) throw new Error(reply.error);
    if (reply.status >= 400) throw new Error(describeStatus(reply.status, reply.json));
    return reply.json as T;
  }

  assertReachable();

  const response = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!response.ok) {
    const failure = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(failure?.error ?? `リクエストに失敗しました (${response.status})`);
  }
  return (await response.json()) as T;
}

export function lastfmStatus(): Promise<LastfmStatus> {
  return getJson<LastfmStatus>("/api/lastfm");
}

export function lastfmSetKeys(apiKey: string, apiSecret: string): Promise<LastfmStatus> {
  return post<LastfmStatus>("/api/lastfm/keys", { apiKey, apiSecret });
}

export function lastfmBegin(): Promise<{ token: string; authUrl: string }> {
  return post<{ token: string; authUrl: string }>("/api/lastfm/begin");
}

export function lastfmComplete(token: string): Promise<{ username: string }> {
  return post<{ username: string }>("/api/lastfm/complete", { token });
}

export function lastfmDisconnect(): Promise<LastfmStatus> {
  return post<LastfmStatus>("/api/lastfm/disconnect");
}

export function lastfmNowPlaying(track: unknown): Promise<{ ok: boolean }> {
  return post<{ ok: boolean }>("/api/lastfm/nowplaying", { track });
}

export function lastfmScrobble(track: unknown, playedAt: number): Promise<{ ok: boolean }> {
  return post<{ ok: boolean }>("/api/lastfm/scrobble", { track, playedAt });
}

/* --------------------- よそのプレイリストを持ってくる --------------------- */

/**
 * 読み取りと突き合わせは分けて呼ぶ。
 *
 * 読み取りはすぐ返るので、まず何が入っているかを見せられる。
 * 突き合わせは曲数ぶん探しに行くので待たされる。
 * 一息に済ませると、中身も分からないまま長く止まって見える。
 */
export function nodeImportPlaylist(input: {
  url?: string;
  text?: string;
}): Promise<PlaylistImportResponse> {
  return post<PlaylistImportResponse>("/api/playlist/import", input);
}

export function nodeMatchPlaylist(entries: ImportedEntry[]): Promise<PlaylistMatchResponse> {
  return post<PlaylistMatchResponse>("/api/playlist/match", { entries });
}

/**
 * ジャケットの取り次ぎ先。
 *
 * クライアントから外部へ直接取りに行かせない方針は変えない。
 * ただし取り次ぐ役は、自分の PC でなくてもよい。
 *
 * 絵は識別子と同じくメタデータの側にある。音声ではないので、
 * 中央を通っても「著作物のバイトは中央を通さない」という前提は崩れない。
 *
 * 自分の PC に道があるならそちらを使う。外に出ない分だけそちらが良い。
 * 中央から配られた画面にはその道が無いので、中央に頼む。
 * こうしておくと、まだ PC につないでいない間も表紙が出る。
 * 直通路は音のために空けておきたいので、絵はそちらに流さない。
 */
export function artworkUrl(source: string | undefined): string | undefined {
  if (!source) return undefined;
  if (hasDirectRoute()) return `${BASE}/api/artwork?url=${encodeURIComponent(source)}`;
  return `${HUB_BASE}/api/artwork?url=${encodeURIComponent(source)}`;
}
