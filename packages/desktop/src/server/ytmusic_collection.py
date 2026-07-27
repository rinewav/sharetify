"""アルバム・プレイリスト・アーティストの中身を取り出す。

検索結果から開いたときに、そこに入っている曲を返す。
標準出力に JSON を 1 行返す。
"""

from __future__ import annotations

import json
import re
import sys
import warnings

warnings.filterwarnings("ignore")

_SIZE_IN_URL = re.compile(r"=w\d+-h\d+")
_ARTWORK_SIZE = 544


def pick_thumbnail(thumbnails: list[dict] | None) -> str | None:
    if not thumbnails:
        return None
    best = max(thumbnails, key=lambda t: t.get("width") or 0)
    url = best.get("url")
    if not url:
        return None
    return _SIZE_IN_URL.sub(f"=w{_ARTWORK_SIZE}-h{_ARTWORK_SIZE}", url)


def join_artists(entry: dict) -> str:
    names = [a.get("name") for a in entry.get("artists") or [] if a.get("name")]
    return "、".join(names) if names else "不明"


def to_track(entry: dict, fallback_artwork: str | None, fallback_album: str | None) -> dict | None:
    video_id = entry.get("videoId")
    title = entry.get("title")
    if not video_id or not title:
        return None

    seconds = entry.get("duration_seconds")
    album = entry.get("album")
    album_name = album.get("name") if isinstance(album, dict) else album

    return {
        "id": video_id,
        "sourceKind": "remote",
        "sourceId": video_id,
        "title": title,
        "artist": join_artists(entry),
        # アルバムの中の曲は個別のジャケットを持たないことがある。表紙で補う。
        "album": album_name or fallback_album,
        "durationMs": int(seconds * 1000) if seconds else None,
        "artworkUrl": pick_thumbnail(entry.get("thumbnails")) or fallback_artwork,
    }


def fetch_album(client, browse_id: str) -> dict:
    data = client.get_album(browse_id)
    artwork = pick_thumbnail(data.get("thumbnails"))
    title = data.get("title") or "アルバム"
    artists = [a.get("name") for a in data.get("artists") or [] if a.get("name")]

    tracks = [
        t
        for t in (to_track(e, artwork, title) for e in data.get("tracks") or [])
        if t is not None
    ]
    return {
        "kind": "album",
        "id": browse_id,
        "title": title,
        "subtitle": "、".join(artists) if artists else None,
        "artworkUrl": artwork,
        "tracks": tracks,
    }


def fetch_playlist(client, playlist_id: str) -> dict:
    # 検索結果の ID は VL 始まりのことがある。曲を引くときは外す。
    normalized = playlist_id[2:] if playlist_id.startswith("VL") else playlist_id
    data = client.get_playlist(normalized, limit=200)
    artwork = pick_thumbnail(data.get("thumbnails"))
    title = data.get("title") or "プレイリスト"
    author = data.get("author")
    author_name = author.get("name") if isinstance(author, dict) else author

    tracks = [
        t for t in (to_track(e, artwork, None) for e in data.get("tracks") or []) if t is not None
    ]
    return {
        "kind": "playlist",
        "id": playlist_id,
        "title": title,
        "subtitle": author_name,
        "artworkUrl": artwork,
        "tracks": tracks,
    }


def fetch_artist(client, browse_id: str) -> dict:
    data = client.get_artist(browse_id)
    artwork = pick_thumbnail(data.get("thumbnails"))
    title = data.get("name") or "アーティスト"

    # 代表曲がそのまま入っている。まずはそれを並べる。
    songs = (data.get("songs") or {}).get("results") or []
    tracks = [t for t in (to_track(e, artwork, None) for e in songs) if t is not None]

    subscribers = data.get("subscribers")
    return {
        "kind": "artist",
        "id": browse_id,
        "title": title,
        "subtitle": f"登録者 {subscribers}" if subscribers else None,
        "artworkUrl": artwork,
        "tracks": tracks,
    }


def main() -> int:
    kind = sys.argv[1] if len(sys.argv) > 1 else ""
    target = sys.argv[2] if len(sys.argv) > 2 else ""

    if kind not in {"album", "playlist", "artist"} or not target:
        json.dump({"error": "failed", "message": "指定が正しくありません。"}, sys.stdout, ensure_ascii=False)
        return 1

    try:
        from ytmusicapi import YTMusic
    except ImportError:
        json.dump(
            {"error": "unavailable", "message": "カタログ検索の準備ができていません。"},
            sys.stdout,
            ensure_ascii=False,
        )
        return 2

    try:
        client = YTMusic()
        if kind == "album":
            result = fetch_album(client, target)
        elif kind == "playlist":
            result = fetch_playlist(client, target)
        else:
            result = fetch_artist(client, target)
    except Exception as error:
        json.dump({"error": "failed", "message": str(error)[:200]}, sys.stdout, ensure_ascii=False)
        return 3

    json.dump(result, sys.stdout, ensure_ascii=False)
    return 0


if __name__ == "__main__":
    sys.exit(main())
