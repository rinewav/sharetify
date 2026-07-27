"""カタログから受け取ったものを、こちらで扱う形に整える処理。

検索と中身の取り出しで同じ整形をするので、ここにまとめる。
"""

from __future__ import annotations

import re

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


def join_artists(entry: dict) -> str:
    names = [a.get("name") for a in entry.get("artists") or [] if a.get("name")]
    return "、".join(names) if names else "不明"


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
