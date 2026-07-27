"""アルバム・プレイリスト・アーティストの中身を取り出す。

検索結果から開いたときに、そこに入っている曲を返す。
標準出力に JSON を 1 行返す。
"""

from __future__ import annotations

import json
import sys
import warnings

warnings.filterwarnings("ignore")

sys.path.insert(0, __file__.rsplit("/", 1)[0])

from ytmusic_common import (  # noqa: E402
    first_artist_id,
    join_artists,
    parse_count,
    pick_thumbnail,
    to_track,
)


def normalize_playlist_id(playlist_id: str) -> str:
    """検索結果の ID は VL 始まりのことがある。曲を引くときは外す。"""
    return playlist_id[2:] if playlist_id.startswith("VL") else playlist_id


def fetch_album(client, browse_id: str) -> dict:
    data = client.get_album(browse_id)
    artwork = pick_thumbnail(data.get("thumbnails"))
    title = data.get("title") or "アルバム"
    artists = [a.get("name") for a in data.get("artists") or [] if a.get("name")]

    tracks = [
        t
        for t in (to_track(e, artwork, title, browse_id) for e in data.get("tracks") or [])
        if t is not None
    ]

    # 副題のアーティストから、その人のページへ辿れるようにする。
    artist_id = first_artist_id(data)

    return {
        "kind": "album",
        "id": browse_id,
        "title": title,
        "subtitle": "、".join(artists) if artists else None,
        "subtitleLink": {"kind": "artist", "id": artist_id} if artist_id else None,
        "artworkUrl": artwork,
        "tracks": tracks,
    }


def fetch_playlist(client, playlist_id: str) -> dict:
    data = client.get_playlist(normalize_playlist_id(playlist_id), limit=300)
    artwork = pick_thumbnail(data.get("thumbnails"))
    title = data.get("title") or "プレイリスト"
    author = data.get("author")
    author_name = author.get("name") if isinstance(author, dict) else author

    tracks = [t for t in (to_track(e, artwork) for e in data.get("tracks") or []) if t is not None]
    return {
        "kind": "playlist",
        "id": playlist_id,
        "title": title,
        "subtitle": author_name,
        "artworkUrl": artwork,
        "tracks": tracks,
    }


def to_release(
    entry: dict, kind_hint: str | None = None, fallback_artist: str | None = None
) -> dict | None:
    """アルバム・シングル・EP を並べるための見出し。"""
    browse_id = entry.get("browseId")
    title = entry.get("title")
    if not browse_id or not title:
        return None

    # ある人のページの中では、誰の作品かは自明なので入っていないことがある。
    # そのまま出すと「不明」と表示されてしまうので、開いている本人の名前で補う。
    artist = join_artists(entry)
    if artist == "不明" and fallback_artist:
        artist = fallback_artist

    return {
        "id": browse_id,
        "playlistId": entry.get("audioPlaylistId") or entry.get("playlistId"),
        "title": title,
        "artist": artist,
        "year": entry.get("year"),
        "kind": entry.get("type") or kind_hint,
        "artworkUrl": pick_thumbnail(entry.get("thumbnails")),
    }


def collect_releases(
    client, data: dict, channel_id: str, key: str, hint: str, artist_name: str | None = None
) -> list[dict]:
    """
    まとまりを集める。

    全件を引く道が用意されている場合はそちらを使うが、
    返ってくる形が想定と違って読めないことがある。
    その場合は最初の画面に出ている分だけでも見せる。
    """
    section = data.get(key) or {}
    results = section.get("results") or []

    params = section.get("params")
    if params:
        try:
            full = client.get_artist_albums(channel_id, params, limit=None)
            if full:
                results = full
        except Exception:
            pass

    return [r for r in (to_release(e, hint, artist_name) for e in results) if r is not None]


def fetch_artist(client, browse_id: str) -> dict:
    data = client.get_artist(browse_id)
    artwork = pick_thumbnail(data.get("thumbnails"))
    title = data.get("name") or "アーティスト"
    channel_id = data.get("channelId") or browse_id

    songs = data.get("songs") or {}

    # 画面に出ているのは代表数曲だけで、曲の長さも入っていない。
    # 全曲がまとまったプレイリストが別にあるので、そちらを引き直す。
    tracks: list[dict] = []
    playlist_id = songs.get("browseId")
    if playlist_id:
        try:
            full = client.get_playlist(normalize_playlist_id(playlist_id), limit=300)
            tracks = [
                t for t in (to_track(e, artwork) for e in full.get("tracks") or []) if t is not None
            ]
        except Exception:
            tracks = []

    # 引き直せなかったときは、少なくとも代表曲だけでも見せる。
    if not tracks:
        tracks = [
            t for t in (to_track(e, artwork) for e in songs.get("results") or []) if t is not None
        ]

    related = [
        {
            "id": e.get("browseId"),
            "name": e.get("title"),
            "subscriberCount": parse_count(e.get("subscribers")),
            "artworkUrl": pick_thumbnail(e.get("thumbnails")),
        }
        for e in (data.get("related") or {}).get("results") or []
        if e.get("browseId") and e.get("title")
    ]

    return {
        "kind": "artist",
        "id": browse_id,
        "title": title,
        "subtitle": None,
        "subscriberCount": parse_count(data.get("subscribers")),
        "monthlyListeners": parse_count(data.get("monthlyListeners")),
        "description": data.get("description"),
        "artworkUrl": artwork,
        "tracks": tracks,
        "albums": collect_releases(client, data, channel_id, "albums", "Album", title),
        "singles": collect_releases(client, data, channel_id, "singles", "Single", title),
        "related": related,
    }


def main() -> int:
    kind = sys.argv[1] if len(sys.argv) > 1 else ""
    target = sys.argv[2] if len(sys.argv) > 2 else ""

    if kind not in {"album", "playlist", "artist"} or not target:
        json.dump(
            {"error": "failed", "message": "指定が正しくありません。"}, sys.stdout, ensure_ascii=False
        )
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
