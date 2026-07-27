"""おすすめの材料を集める。

何を勧めるかをこちらで考えるのではなく、手掛かり (種) だけ渡して
供給元の推薦をそのまま使う。自前で仕組みを組むより精度が出る。

  radio   : ある曲を種に、続けて流す曲を並べる
  home    : 地域向けの汎用のおすすめ (自分の好みは反映されない)

標準出力に JSON を 1 行返す。
"""

from __future__ import annotations

import json
import sys
import warnings

warnings.filterwarnings("ignore")

sys.path.insert(0, __file__.rsplit("/", 1)[0])

from ytmusic_common import pick_thumbnail, pick_views, to_track  # noqa: E402

# 地域を指定すると、その土地で聴かれているものが返る。
LANGUAGE = "ja"
LOCATION = "JP"


def fetch_radio(client, video_id: str, limit: int) -> dict:
    data = client.get_watch_playlist(videoId=video_id, radio=True, limit=limit)
    tracks = [t for t in (to_track(e) for e in data.get("tracks") or []) if t is not None]
    # 種そのものが先頭に入っている。並びとしては残したままでよい。
    return {"tracks": tracks[:limit]}


def fetch_home(client, limit: int) -> dict:
    sections = []
    for section in client.get_home(limit=limit):
        items = []
        for entry in section.get("contents") or []:
            # 曲としてそのまま鳴らせるものと、開いて中を見るものを分ける。
            if entry.get("videoId"):
                track = to_track(entry)
                if track:
                    item = {"type": "track", "track": track}
                    # 演奏者が分からないときは、代わりに出すものを添える。
                    if track["artist"] == "不明":
                        views = pick_views(entry)
                        if views:
                            item["subtitle"] = views
                    items.append(item)
                continue

            playlist_id = entry.get("playlistId")
            browse_id = entry.get("browseId")
            title = entry.get("title")
            if not title:
                continue

            if playlist_id or (browse_id or "").startswith(("VL", "RD", "PL")):
                items.append(
                    {
                        "type": "playlist",
                        "id": playlist_id or browse_id,
                        "title": title,
                        "subtitle": entry.get("description"),
                        "artworkUrl": pick_thumbnail(entry.get("thumbnails")),
                    }
                )
            elif browse_id and browse_id.startswith("MPREb"):
                items.append(
                    {
                        "type": "album",
                        "id": browse_id,
                        "title": title,
                        "subtitle": entry.get("description"),
                        "artworkUrl": pick_thumbnail(entry.get("thumbnails")),
                    }
                )

        if items:
            sections.append({"title": section.get("title") or "おすすめ", "items": items})

    return {"sections": sections}


def main() -> int:
    mode = sys.argv[1] if len(sys.argv) > 1 else ""
    target = sys.argv[2] if len(sys.argv) > 2 else ""
    limit = int(sys.argv[3]) if len(sys.argv) > 3 else 25

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
        client = YTMusic(language=LANGUAGE, location=LOCATION)
        if mode == "radio":
            if not target:
                json.dump({"error": "failed", "message": "種が必要です。"}, sys.stdout)
                return 1
            result = fetch_radio(client, target, limit)
        elif mode == "home":
            result = fetch_home(client, limit)
        else:
            json.dump({"error": "failed", "message": "指定が正しくありません。"}, sys.stdout)
            return 1
    except Exception as error:
        json.dump({"error": "failed", "message": str(error)[:200]}, sys.stdout, ensure_ascii=False)
        return 3

    json.dump(result, sys.stdout, ensure_ascii=False)
    return 0


if __name__ == "__main__":
    sys.exit(main())
