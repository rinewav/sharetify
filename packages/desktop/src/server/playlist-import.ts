import type {
  ImportedEntry,
  ImportSource,
  PlaylistImportResponse,
  PlaylistMatchItem,
  PlaylistMatchResponse,
  Track,
} from "@sharetify/shared";
import { search } from "./resolver.js";

/**
 * よそのプレイリストを持ってくる。
 *
 * 読み取るのは曲の題と演奏者だけで、音声には一切触れない。
 * 向こうは「何が入っているか」の一覧を人に見せるために公開している。
 * その見えている部分だけを読み、鳴らすものは今までどおり手元で探す。
 *
 * Spotify と Apple Music は、公開されている紹介ページの中に
 * 一覧がそのまま埋まっているので、それを取り出す。鍵の登録は要らない。
 *
 * Amazon Music はページに一覧が入っておらず、開いたあとに向こうへ
 * 問い合わせて組み立てる作りになっている。その問い合わせには持ち主の
 * 資格が要るので、こちらからは読めない。貼り付けで受ける道を用意してある。
 */

/** 向こうに人が見ている画面と同じものを返してもらう。 */
const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const FETCH_TIMEOUT_MS = 20_000;

/** 一度に持ってくる上限。長大な一覧で手元が詰まらないようにする。 */
const MAX_ENTRIES = 500;

export class ImportFailure extends Error {}

/* ------------------------------------------------------------------ *
 * 読み取り
 * ------------------------------------------------------------------ */

export async function importPlaylist(input: {
  url?: string;
  text?: string;
}): Promise<PlaylistImportResponse> {
  const url = input.url?.trim();
  const text = input.text?.trim();

  if (url) {
    const source = detectSource(url);
    if (source === "spotify") return await fromSpotify(url);
    if (source === "apple-music") return await fromAppleMusic(url);
    throw new ImportFailure(
      "このアドレスからは読み取れません。Spotify か Apple Music のプレイリストのアドレス、" +
        "または曲名を貼り付けてください。",
    );
  }

  if (text) return fromText(text);

  throw new ImportFailure("アドレスか、貼り付けた曲名が要ります。");
}

/** アドレスの見た目から、どこのものかを決める。 */
export function detectSource(url: string): ImportSource | null {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }

  if (host === "open.spotify.com" || host.endsWith(".spotify.com")) return "spotify";
  if (host === "music.apple.com" || host.endsWith(".music.apple.com")) return "apple-music";
  return null;
}

async function fetchPage(url: string): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      headers: { "user-agent": BROWSER_UA, "accept-language": "ja,en;q=0.8" },
      signal: controller.signal,
      redirect: "follow",
    });

    if (!response.ok) {
      throw new ImportFailure(`向こうから ${response.status} が返りました。`);
    }

    return await response.text();
  } catch (error) {
    if (error instanceof ImportFailure) throw error;
    if (error instanceof Error && error.name === "AbortError") {
      throw new ImportFailure("読み取りに時間がかかりすぎました。");
    }
    throw new ImportFailure("ページを取ってこられませんでした。");
  } finally {
    clearTimeout(timer);
  }
}

/**
 * ページに埋まっている塊を取り出す。
 *
 * 素直に閉じ札まで拾うと、中身に同じ並びが出てきたところで切れてしまう。
 * 開き札の直後から、対応する閉じ札の手前までを丸ごと取る。
 */
function extractScript(html: string, attribute: string): string | null {
  const opening = new RegExp(`<script[^>]*${attribute}[^>]*>`, "i").exec(html);
  if (!opening) return null;

  const from = opening.index + opening[0].length;
  const to = html.indexOf("</script>", from);
  if (to < 0) return null;

  return html.slice(from, to).trim();
}

/* ------------------------------------------------------------------ *
 * Spotify
 *
 * 埋め込み用のページに、題と演奏者の並びがそのまま入っている。
 * ------------------------------------------------------------------ */

interface SpotifyEmbedTrack {
  title?: string;
  subtitle?: string;
}

async function fromSpotify(url: string): Promise<PlaylistImportResponse> {
  const id = spotifyPlaylistId(url);
  if (!id) throw new ImportFailure("Spotify のプレイリストのアドレスではないようです。");

  const html = await fetchPage(`https://open.spotify.com/embed/playlist/${id}`);
  const raw = extractScript(html, 'id="__NEXT_DATA__"');
  if (!raw) throw new ImportFailure("Spotify のページから中身を読み取れませんでした。");

  let entity: { name?: string; trackList?: SpotifyEmbedTrack[] };
  try {
    const parsed = JSON.parse(raw) as {
      props?: { pageProps?: { state?: { data?: { entity?: typeof entity } } } };
    };
    entity = parsed.props?.pageProps?.state?.data?.entity ?? {};
  } catch {
    throw new ImportFailure("Spotify のページの形が変わっているようです。");
  }

  const entries = (entity.trackList ?? [])
    .map((item) => ({
      title: (item.title ?? "").trim(),
      // 演奏者が複数いるときは中黒で並ぶ。先頭だけを代表として使う。
      artist: primaryArtist(item.subtitle ?? ""),
    }))
    .filter((entry) => entry.title.length > 0);

  return finish("spotify", entity.name ?? "Spotify のプレイリスト", entries);
}

function spotifyPlaylistId(url: string): string | null {
  const matched = /\/playlist\/([A-Za-z0-9]+)/.exec(url);
  return matched?.[1] ?? null;
}

/* ------------------------------------------------------------------ *
 * Apple Music
 *
 * 紹介ページに、表示用の一覧がそのまま埋まっている。
 * 先頭の区画が見出しで、その次の区画に曲が並ぶ。
 * ------------------------------------------------------------------ */

interface AppleItem {
  kind?: string;
  title?: string;
  artistName?: string;
  tertiaryLinks?: { title?: string }[];
}

interface AppleSection {
  items?: AppleItem[];
}

async function fromAppleMusic(url: string): Promise<PlaylistImportResponse> {
  const html = await fetchPage(url);
  const raw = extractScript(html, 'id="serialized-server-data"');
  if (!raw) throw new ImportFailure("Apple Music のページから中身を読み取れませんでした。");

  let sections: AppleSection[];
  try {
    const parsed = JSON.parse(raw) as {
      data?: { data?: { sections?: AppleSection[] } }[];
    };
    sections = parsed.data?.[0]?.data?.sections ?? [];
  } catch {
    throw new ImportFailure("Apple Music のページの形が変わっているようです。");
  }

  const name = sections[0]?.items?.[0]?.title?.trim();

  /*
   * 曲が入っている区画を探す。
   *
   * 何番目に来るかは決まっていないので、演奏者の名前を持つ品が
   * 並んでいるところを曲の区画と見なす。
   */
  const entries: ImportedEntry[] = [];
  for (const section of sections) {
    const items = (section.items ?? []).filter((item) => item.artistName && item.title);
    if (items.length === 0) continue;

    for (const item of items) {
      entries.push({
        title: item.title!.trim(),
        artist: primaryArtist(item.artistName!),
        album: item.tertiaryLinks?.[0]?.title?.trim() || undefined,
      });
    }
    break;
  }

  return finish("apple-music", name || "Apple Music のプレイリスト", entries);
}

/* ------------------------------------------------------------------ *
 * 貼り付け
 *
 * Amazon Music のようにページから読めないものは、画面から写した文字で受ける。
 * 「曲名 - 演奏者」「演奏者 - 曲名」のどちらでも、区切りが無い並びでも通す。
 * ------------------------------------------------------------------ */

/** 手で写したときに混ざる区切り。全角の類も見る。 */
const SEPARATORS = [" - ", " – ", " — ", " / ", "\t", " ・ ", " − "];

function fromText(text: string): PlaylistImportResponse {
  const entries: ImportedEntry[] = [];

  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // 頭の番号は写したときに付いてくるだけなので落とす。
    const body = trimmed.replace(/^\s*\d+[.)、]?\s+/, "");
    const separator = SEPARATORS.find((candidate) => body.includes(candidate));

    if (!separator) {
      // 区切りが無いなら、行そのものを手掛かりにして探す。
      entries.push({ title: body, artist: "" });
      continue;
    }

    const at = body.indexOf(separator);
    const left = body.slice(0, at).trim();
    const right = body.slice(at + separator.length).trim();
    if (!left || !right) continue;

    entries.push({ title: left, artist: primaryArtist(right) });
  }

  return finish("text", "貼り付けたプレイリスト", entries);
}

/* ------------------------------------------------------------------ *
 * 突き合わせ
 * ------------------------------------------------------------------ */

/** 同時に走らせる数。Python を何本も立てると手元が重くなる。 */
const MATCH_CONCURRENCY = 4;

export async function matchEntries(entries: ImportedEntry[]): Promise<PlaylistMatchResponse> {
  const items: PlaylistMatchItem[] = new Array(entries.length);
  let cursor = 0;

  /*
   * 前から順に、空いた口へ流し込む。
   *
   * 全部まとめて投げると Python が人数ぶん立ち上がって手元が詰まる。
   * かといって一本ずつ待つと、曲数ぶんの待ち時間がそのまま積み上がる。
   */
  async function worker(): Promise<void> {
    for (;;) {
      const index = cursor++;
      if (index >= entries.length) return;

      const entry = entries[index]!;
      items[index] = { entry, track: await findOne(entry) };
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(MATCH_CONCURRENCY, entries.length) }, () => worker()),
  );

  const matched = items.filter((item) => item.track).length;
  return { items, matched, missed: items.length - matched };
}

async function findOne(entry: ImportedEntry): Promise<Track | null> {
  const query = [entry.artist, entry.title].filter(Boolean).join(" ").trim();
  if (!query) return null;

  try {
    /*
     * 候補は少し多めに見る。
     *
     * 曲によっては、上のほうが実演の記録や別の人の弾き直しで埋まる。
     * 数を絞ると、その下にある目当てのものへ届かない。
     */
    const found = await search(query, 8);
    return pickBest(entry, found.tracks);
  } catch {
    /*
     * 一曲取りこぼしても、残りの取り込みは続ける。
     * ここで投げると、長い一覧の途中で全部が無かったことになる。
     */
    return null;
  }
}

/**
 * 候補の中から一番それらしいものを選ぶ。
 *
 * 上から順に採ると、同じ題の別人の演奏や、切り貼りされたものを掴む。
 * 題と演奏者の重なり具合で点を付け、いちばん高いものを選ぶ。
 */
function pickBest(entry: ImportedEntry, candidates: Track[]): Track | null {
  if (candidates.length === 0) return null;

  let best: Track | null = null;
  let bestScore = -1;

  const title = normalize(entry.title);
  const artist = normalize(entry.artist);

  for (const candidate of candidates) {
    const candidateTitle = normalize(candidate.title);
    const candidateArtist = normalize(candidate.artist);

    const asRead = similarity(title, candidateTitle) * 2 +
      (artist ? similarity(artist, candidateArtist) : 0);

    /*
     * 逆に読んだ場合も見る。
     *
     * 貼り付けで受け取った行は「曲名 - 演奏者」とは限らず、
     * 「演奏者 - 曲名」で並んでいることも多い。区切りだけでは
     * どちらが題なのか決められないので、両取りして高いほうを信じる。
     */
    const swapped = artist
      ? similarity(artist, candidateTitle) * 2 + similarity(title, candidateArtist)
      : 0;

    /*
     * 同じ点なら、但し書きの付いていないほうを採る。
     *
     * 見比べる前に括弧の中を落としているので、原曲とライブ版・
     * 手直し版はまったく同じ点になる。そのまま先頭を採ると、
     * 一覧のあちこちが別録りに化けてしまう。
     * 落とした量を控えめに引いて、飾りの少ないほうへ倒す。
     */
    const decoration = (candidate.title.length - candidateTitle.length) / 200;

    const score = Math.max(asRead, swapped) - decoration;
    if (score > bestScore) {
      bestScore = score;
      best = candidate;
    }
  }

  /*
   * どれも遠いなら、無かったことにする。
   * 似ていないものを黙って入れるより、取りこぼしとして見せたほうがよい。
   */
  return bestScore >= 0.6 ? best : null;
}

/** 見比べる前に、表記の揺れを均す。 */
function normalize(value: string): string {
  return value
    .toLowerCase()
    // 括弧書き (Remaster、feat. など) は付いたり付かなかったりする。
    .replace(/[([【（].*?[)\]】）]/g, " ")
    .replace(/\bfeat\.?\b.*$/i, " ")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** 語の重なり具合。0 から 1。 */
function similarity(left: string, right: string): number {
  if (!left || !right) return 0;
  if (left === right) return 1;

  const leftWords = new Set(left.split(" "));
  const rightWords = new Set(right.split(" "));
  let shared = 0;
  for (const word of leftWords) if (rightWords.has(word)) shared++;

  return shared / Math.max(leftWords.size, rightWords.size);
}

/* ------------------------------------------------------------------ *
 * 共通の仕上げ
 * ------------------------------------------------------------------ */

/** 演奏者が複数並ぶときは、先頭だけを代表として使う。 */
function primaryArtist(value: string): string {
  return value.split(/[,、]|\s+&\s+|\s+feat\.?\s+/i)[0]?.trim() ?? "";
}

function finish(
  source: ImportSource,
  name: string,
  entries: ImportedEntry[],
): PlaylistImportResponse {
  if (entries.length === 0) {
    throw new ImportFailure("曲が一つも見つかりませんでした。公開されている一覧か確かめてください。");
  }

  return { source, name: name.trim(), entries: entries.slice(0, MAX_ENTRIES) };
}
