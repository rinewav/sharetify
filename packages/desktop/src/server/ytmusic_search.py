"""楽曲カタログの検索。

通常の動画検索を使うと、動画としての尺 (末尾に無音や静止画が続くもの) や
1 時間のミックスばかりが上位に来てしまう。楽曲として登録されているものを
引きたいので、こちらを経由する。

曲だけでなくアーティスト・アルバム・プレイリストも返す。
種別を指定せずに一度で引くと見出しが項目に混ざって質が落ちるので、
種別ごとに引いたうえでまとめる。待ち時間が伸びないよう並べて実行する。

標準出力に JSON を 1 行返す。呼び出し側はそれだけを読む。
"""

from __future__ import annotations

import json
import sys
import warnings
from concurrent.futures import ThreadPoolExecutor

warnings.filterwarnings("ignore")

sys.path.insert(0, __file__.rsplit("/", 1)[0])

from ytmusic_common import (  # noqa: E402
    join_artists,
    parse_count,
    pick_thumbnail,
    to_track,
)


def to_album(entry: dict) -> dict | None:
    browse_id = entry.get("browseId")
    title = entry.get("title")
    if not browse_id or not title:
        return None

    return {
        "id": browse_id,
        "playlistId": entry.get("playlistId"),
        "title": title,
        "artist": join_artists(entry),
        "year": entry.get("year"),
        # アルバム / シングル / EP の区別。表示の並べ分けに使う。
        "kind": entry.get("type"),
        "artworkUrl": pick_thumbnail(entry.get("thumbnails")),
    }


def to_artist(entry: dict) -> dict | None:
    browse_id = entry.get("browseId")
    # アーティストの表示名は artists 側に入っていることがある。
    name = entry.get("artist") or entry.get("title") or join_artists(entry)
    if not browse_id or not name or name == "不明":
        return None

    return {
        "id": browse_id,
        "name": name,
        "subscribers": entry.get("subscribers"),
        "subscriberCount": parse_count(entry.get("subscribers")),
        "artworkUrl": pick_thumbnail(entry.get("thumbnails")),
    }


def to_playlist(entry: dict) -> dict | None:
    browse_id = entry.get("browseId") or entry.get("playlistId")
    title = entry.get("title")
    if not browse_id or not title:
        return None

    return {
        "id": browse_id,
        "title": title,
        "author": entry.get("author"),
        "itemCount": parse_count(entry.get("itemCount")),
        "artworkUrl": pick_thumbnail(entry.get("thumbnails")),
    }


def main() -> int:
    query = sys.argv[1] if len(sys.argv) > 1 else ""
    limit = int(sys.argv[2]) if len(sys.argv) > 2 else 20

    if not query.strip():
        json.dump({"tracks": [], "albums": [], "artists": [], "playlists": []}, sys.stdout)
        return 0

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
    except Exception as error:
        json.dump(
            {"error": "failed", "message": str(error)[:200]},
            sys.stdout,
            ensure_ascii=False,
        )
        return 3

    # 種別ごとの問い合わせは互いに独立しているので、待ち時間を重ねない。
    plan = [
        ("songs", limit, lambda e: to_track(e), "tracks"),
        ("albums", 8, to_album, "albums"),
        ("artists", 6, to_artist, "artists"),
        ("community_playlists", 8, to_playlist, "playlists"),
    ]

    def run(spec):
        kind, count, mapper, key = spec
        try:
            entries = client.search(query, filter=kind, limit=count)
        except Exception:
            # 一部が取れなくても、取れたものだけ見せたほうが役に立つ。
            return key, []
        mapped = [m for m in (mapper(e) for e in entries) if m is not None]
        return key, mapped[:count]

    with ThreadPoolExecutor(max_workers=len(plan)) as pool:
        results = dict(pool.map(run, plan))

    if not any(results.values()):
        json.dump(
            {"error": "failed", "message": "検索結果を取得できませんでした。"},
            sys.stdout,
            ensure_ascii=False,
        )
        return 3

    json.dump(
        {
            "tracks": results.get("tracks", []),
            "albums": results.get("albums", []),
            "artists": results.get("artists", []),
            "playlists": results.get("playlists", []),
        },
        sys.stdout,
        ensure_ascii=False,
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
