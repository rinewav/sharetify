"""カタログから受け取ったものを、こちらで扱う形に整える処理。

検索と中身の取り出しで同じ整形をするので、ここにまとめる。
"""

from __future__ import annotations

import re
import sys

# 出力は常に UTF-8 で書く。
#
# Windows の Python は、パイプへの出力を OS の文字コード (日本語環境では
# cp932) で書こうとする。曲名にはそこに無い文字が普通に混ざるので、
# JSON を書き出す途中で UnicodeEncodeError になり、検索そのものが失敗する。
# 受け取る側 (Node) は常に UTF-8 として読むため、こちらで固定するのが正しい。
for stream in (sys.stdout, sys.stderr):
    if hasattr(stream, "reconfigure"):
        stream.reconfigure(encoding="utf-8")

# 返ってくる URL は 120px 指定のことが多い。末尾の寸法を書き換えれば
# 同じ画像を大きいサイズで取れるので、表示に耐える解像度に上げておく。
_SIZE_IN_URL = re.compile(r"=w\d+-h\d+")
ARTWORK_SIZE = 544

# "462K" や "4.86M" のような略記。数値に直して渡す。
_COUNT_PATTERN = re.compile(r"^([\d.,]+)\s*([KMB万億])?", re.IGNORECASE)
_COUNT_SCALE = {"k": 1_000, "m": 1_000_000, "b": 1_000_000_000, "万": 10_000, "億": 100_000_000}


def pick_thumbnail(thumbnails: list[dict] | None) -> str | None:
    """一番大きいものを選ぶ。並び順は保証されていないので幅で判断する。"""
    if not thumbnails:
        return None
    best = max(thumbnails, key=lambda t: t.get("width") or 0)
    url = best.get("url")
    if not url:
        return None
    return _SIZE_IN_URL.sub(f"=w{ARTWORK_SIZE}-h{ARTWORK_SIZE}", url)


# 数え上げを表す言い回し。
#
# 供給元は副題に色々な数を出す。再生回数、視聴回数、高く評価した数、
# 聴いている人の数。どれも演奏者ではないのに、演奏者として渡ってくる。
#
# カタログ側の解析は英語表記 (数字で始まり空白が 1 つ) を前提に見分けているので、
# 日本語で受け取ると判定から漏れ、識別子のない演奏者として扱われてしまう。
# こちらで日本語を指定している以上、取り違えを引き受けるのもこちら側の仕事。
# 一つ見落とすと、その言い回しのときだけ名前が化ける。
_COUNT_WORD = re.compile(
    r"(再生回数|回視聴|回再生|高評価|評価|いいね|チャンネル登録者|登録者|"
    r"views?|likes?|listeners?|subscribers?|plays?)",
    re.IGNORECASE,
)
# 数え上げには必ず数が付く。単位だけの言葉は数え上げではない。
_HAS_COUNT = re.compile(r"[\d０-９]")

# 出した年。副題に添えられるが、演奏者ではない。
#
# 「年」を伴う形だけを落とす。裸の四桁も年に見えるが、
# The 1975 のように数字そのものを名に持つ演奏者がいるので手を出さない。
_YEAR = re.compile(r"^[\d０-９]{4}\s*年$")


def _is_count_text(name: str) -> bool:
    """
    演奏者名ではなく数え上げの表記か。識別子を持つものは必ず演奏者なので呼ばない。

    語だけで判ずると "Rear View Mirror" のような実在の名前まで落ちてしまう。
    数え上げには必ず数が付くので、両方そろったときだけそう見なす。
    """
    return bool(_COUNT_WORD.search(name)) and bool(_HAS_COUNT.search(name))


def _is_meta_text(name: str) -> bool:
    """演奏者の欄に紛れ込む、演奏者でないもの。数え上げと、出した年。"""
    return _is_count_text(name) or bool(_YEAR.match(name.strip()))


def join_artists(entry: dict) -> str:
    names = [
        name
        for artist in entry.get("artists") or []
        # 識別子があるものは確実に演奏者。無いものだけ中身を疑う。
        if (name := artist.get("name")) and (artist.get("id") or not _is_meta_text(name))
    ]
    return "、".join(names) if names else "不明"


def pick_views(entry: dict) -> str | None:
    """回数の表記を拾う。演奏者が分からないとき、副題として出すために使う。"""
    views = entry.get("views")
    if views and _is_count_text(str(views)):
        return str(views)

    for artist in entry.get("artists") or []:
        name = artist.get("name")
        if name and not artist.get("id") and _is_count_text(name):
            return name
    return views or None


def first_artist_id(entry: dict) -> str | None:
    """代表アーティストの識別子。表示名からは辿れないので別に持たせる。"""
    for artist in entry.get("artists") or []:
        if artist.get("id"):
            return artist["id"]
    return None


def parse_count(value: str | int | None) -> int | None:
    """略記された人数を数値に直す。表示の桁区切りは受け取った側で行う。"""
    if value is None:
        return None
    if isinstance(value, int):
        return value

    match = _COUNT_PATTERN.match(str(value).strip())
    if not match:
        return None

    try:
        number = float(match.group(1).replace(",", ""))
    except ValueError:
        return None

    suffix = (match.group(2) or "").lower()
    return int(number * _COUNT_SCALE.get(suffix, 1))


def parse_length(value: str | None) -> int | None:
    """"4:24" や "1:02:03" のような表記を秒数に直す。"""
    if not value:
        return None
    parts = value.strip().split(":")
    try:
        numbers = [int(p) for p in parts]
    except ValueError:
        return None

    seconds = 0
    for number in numbers:
        seconds = seconds * 60 + number
    return seconds


def to_track(
    entry: dict,
    fallback_artwork: str | None = None,
    fallback_album: str | None = None,
    fallback_album_id: str | None = None,
) -> dict | None:
    video_id = entry.get("videoId")
    title = entry.get("title")
    if not video_id or not title:
        return None

    # 経路によって入っている名前が違う。続けて流す曲の一覧では
    # 単数形の thumbnail と、"4:24" 形式の length で返ってくる。
    seconds = entry.get("duration_seconds") or parse_length(entry.get("length"))
    album = entry.get("album")
    album_name = album.get("name") if isinstance(album, dict) else album
    album_id = album.get("id") if isinstance(album, dict) else None

    return {
        "id": video_id,
        "sourceKind": "remote",
        "sourceId": video_id,
        "title": title,
        "artist": join_artists(entry),
        # アルバムの中の曲は個別のジャケットを持たないことがある。表紙で補う。
        "album": album_name or fallback_album,
        "durationMs": int(seconds * 1000) if seconds else None,
        "artworkUrl": pick_thumbnail(entry.get("thumbnails") or entry.get("thumbnail"))
        or fallback_artwork,
        "artistId": first_artist_id(entry),
        "albumId": album_id or fallback_album_id,
    }
