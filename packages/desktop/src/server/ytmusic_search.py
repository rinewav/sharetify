"""楽曲カタログの検索。

通常の動画検索を使うと、動画としての尺 (末尾に無音や静止画が続くもの) や
1 時間のミックスばかりが上位に来てしまう。楽曲として登録されているものを
引きたいので、こちらを経由する。

標準出力に JSON を 1 行返す。呼び出し側はそれだけを読む。
"""

from __future__ import annotations

import json
import re
import sys
import warnings

warnings.filterwarnings("ignore")

# 返ってくる URL は 120px 指定のことが多い。末尾の寸法を書き換えれば
# 同じ画像を大きいサイズで取れるので、表示に耐える解像度に上げておく。
_SIZE_IN_URL = re.compile(r"=w\d+-h\d+")
_ARTWORK_SIZE = 544


def pick_thumbnail(thumbnails: list[dict]) -> str | None:
    """一番大きいものを選ぶ。並び順は保証されていないので幅で判断する。"""
    if not thumbnails:
        return None
    best = max(thumbnails, key=lambda t: t.get("width") or 0)
    url = best.get("url")
    if not url:
        return None
    return _SIZE_IN_URL.sub(f"=w{_ARTWORK_SIZE}-h{_ARTWORK_SIZE}", url)


def to_track(entry: dict) -> dict | None:
    video_id = entry.get("videoId")
    title = entry.get("title")
    if not video_id or not title:
        return None

    artists = [a.get("name") for a in entry.get("artists") or [] if a.get("name")]
    album = (entry.get("album") or {}).get("name")
    seconds = entry.get("duration_seconds")

    return {
        "id": video_id,
        "sourceKind": "remote",
        "sourceId": video_id,
        "title": title,
        "artist": "、".join(artists) if artists else "不明",
        "album": album,
        "durationMs": int(seconds * 1000) if seconds else None,
        "artworkUrl": pick_thumbnail(entry.get("thumbnails") or []),
    }


def main() -> int:
    query = sys.argv[1] if len(sys.argv) > 1 else ""
    limit = int(sys.argv[2]) if len(sys.argv) > 2 else 20

    if not query.strip():
        json.dump({"tracks": []}, sys.stdout, ensure_ascii=False)
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
        results = client.search(query, filter="songs", limit=limit)
    except Exception as error:  # 通信断・仕様変更などは呼び出し側で拾わせる
        json.dump(
            {"error": "failed", "message": str(error)[:200]},
            sys.stdout,
            ensure_ascii=False,
        )
        return 3

    tracks = [t for t in (to_track(entry) for entry in results) if t is not None]
    json.dump({"tracks": tracks[:limit]}, sys.stdout, ensure_ascii=False)
    return 0


if __name__ == "__main__":
    sys.exit(main())
