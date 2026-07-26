import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Wifi, WifiOff } from "lucide-react";
import type { CacheState } from "@musicshare/shared";
import { PlayerBar } from "./components/PlayerBar.js";
import { SessionPanel } from "./components/SessionPanel.js";
import { Sidebar } from "./components/Sidebar.js";
import { mockGroups, mockPlaylists } from "./lib/mock.js";
import { usePlayer } from "./lib/player-store.js";
import { useSession } from "./lib/session-store.js";
import type { Route } from "./lib/routes.js";
import { GroupsView } from "./views/GroupsView.js";
import { HomeView } from "./views/HomeView.js";
import { PlaylistView } from "./views/PlaylistView.js";
import { SearchView } from "./views/SearchView.js";

/** どの曲が手元にあるか。実装が進んだら node の cache API から取る。 */
const cacheStates: Record<string, CacheState> = {
  t1: "ready",
  t2: "ready",
  t3: "downloading",
  t5: "ready",
  t9: "ready",
  t11: "failed",
};

export default function App() {
  const [route, setRoute] = useState<Route>({ name: "home" });
  const [history, setHistory] = useState<Route[]>([]);
  const [future, setFuture] = useState<Route[]>([]);
  const [sessionPanelOpen, setSessionPanelOpen] = useState(false);

  const sessionConnected = useSession((s) => s.connected);
  // 自分の PC に繋がっているか。落ちていれば DL 済みしか鳴らせない。
  const [nodeOnline] = useState(true);

  usePlaybackClock();
  useMediaSession();

  const navigate = (next: Route) => {
    setHistory((h) => [...h, route]);
    setFuture([]);
    setRoute(next);
  };

  const goBack = () => {
    setHistory((h) => {
      const previous = h.at(-1);
      if (!previous) return h;
      setFuture((f) => [route, ...f]);
      setRoute(previous);
      return h.slice(0, -1);
    });
  };

  const goForward = () => {
    setFuture((f) => {
      const next = f[0];
      if (!next) return f;
      setHistory((h) => [...h, route]);
      setRoute(next);
      return f.slice(1);
    });
  };

  const panelOpen = sessionPanelOpen || sessionConnected;

  const content = useMemo(() => {
    switch (route.name) {
      case "home":
        return <HomeView playlists={mockPlaylists} onNavigate={navigate} />;
      case "search":
        return <SearchView cacheStates={cacheStates} nodeOnline={nodeOnline} />;
      case "groups":
        return (
          <GroupsView groups={mockGroups} playlists={mockPlaylists} onNavigate={navigate} />
        );
      case "playlist": {
        const playlist = mockPlaylists.find((p) => p.id === route.playlistId);
        if (!playlist) return <div className="p-6 text-ink-muted">見つかりません</div>;
        return (
          <PlaylistView playlist={playlist} groups={mockGroups} cacheStates={cacheStates} />
        );
      }
    }
  }, [route, nodeOnline]);

  return (
    <div className="flex h-full flex-col bg-base">
      <div className="flex min-h-0 flex-1 gap-2 p-2">
        <Sidebar
          route={route}
          onNavigate={navigate}
          playlists={mockPlaylists}
          groups={mockGroups}
        />

        <main className="relative flex min-w-0 flex-1 flex-col overflow-hidden rounded-lg bg-surface">
          <header className="absolute inset-x-0 top-0 z-10 flex items-center justify-between gap-4 bg-surface/70 px-6 py-3 backdrop-blur">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={goBack}
                disabled={history.length === 0}
                className="grid size-8 place-items-center rounded-full bg-base/60 text-ink-muted transition hover:text-ink disabled:opacity-40"
                aria-label="戻る"
              >
                <ChevronLeft className="size-5" />
              </button>
              <button
                type="button"
                onClick={goForward}
                disabled={future.length === 0}
                className="grid size-8 place-items-center rounded-full bg-base/60 text-ink-muted transition hover:text-ink disabled:opacity-40"
                aria-label="進む"
              >
                <ChevronRight className="size-5" />
              </button>
            </div>

            <div className="flex items-center gap-3">
              <span
                className="flex items-center gap-1.5 rounded-full bg-base/60 px-3 py-1.5 text-xs text-ink-muted"
                title={
                  nodeOnline
                    ? "自分の PC に接続しています"
                    : "自分の PC に接続できていません。ダウンロード済みのみ再生できます"
                }
              >
                {nodeOnline ? (
                  <Wifi className="size-3.5 text-accent" />
                ) : (
                  <WifiOff className="size-3.5 text-ink-faint" />
                )}
                {nodeOnline ? "自分の PC" : "オフライン"}
              </span>
              <div className="grid size-8 place-items-center rounded-full bg-surface-3 text-xs font-semibold">
                り
              </div>
            </div>
          </header>

          <div className="min-h-0 flex-1 overflow-y-auto">{content}</div>
        </main>

        {panelOpen && <SessionPanel onClose={() => setSessionPanelOpen(false)} />}
      </div>

      <PlayerBar
        sessionPanelOpen={panelOpen}
        onToggleSessionPanel={() => setSessionPanelOpen((open) => !open)}
      />
    </div>
  );
}

/**
 * 再生位置を進めるだけのクロック。
 *
 * 仮組みでは音を鳴らさずここで時間を進める。
 * 実装が進んだら audio 要素の timeupdate に置き換える。構造は変わらない。
 */
function usePlaybackClock(): void {
  const playing = usePlayer((s) => s.playing);

  useEffect(() => {
    if (!playing) return;
    const interval = 250;
    const timer = setInterval(() => usePlayer.getState().tick(interval), interval);
    return () => clearInterval(timer);
  }, [playing]);
}

/**
 * ロック画面・コントロールセンターへの反映。
 *
 * この構成で iPhone をネイティブアプリらしく見せる肝がここなので、
 * 仮組みの段階から配線しておく。
 */
function useMediaSession(): void {
  const track = usePlayer((s) => s.current());
  const playing = usePlayer((s) => s.playing);

  useEffect(() => {
    if (!("mediaSession" in navigator)) return;

    navigator.mediaSession.metadata = track
      ? new MediaMetadata({
          title: track.title,
          artist: track.artist,
          album: track.album,
        })
      : null;

    navigator.mediaSession.playbackState = playing ? "playing" : "paused";

    const player = usePlayer.getState();
    navigator.mediaSession.setActionHandler("play", () => player.toggle());
    navigator.mediaSession.setActionHandler("pause", () => player.toggle());
    navigator.mediaSession.setActionHandler("previoustrack", () => player.prev());
    navigator.mediaSession.setActionHandler("nexttrack", () => player.next());
    navigator.mediaSession.setActionHandler("seekto", (details) => {
      if (details.seekTime !== undefined) player.seek(details.seekTime * 1000);
    });
  }, [track, playing]);
}
