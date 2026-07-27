import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, ChevronLeft, ChevronRight, Wifi, WifiOff } from "lucide-react";
import type { CacheState, CollectionKind, NodeHealth, Track } from "@musicshare/shared";
import { AddToPlaylistSheet } from "./components/AddToPlaylistSheet.js";
import { LayoutProbe, layoutProbeEnabled } from "./components/LayoutProbe.js";
import { MobileNav } from "./components/MobileNav.js";
import { PairingSheet, useAutoPairing } from "./components/PairingSheet.js";
import { PlayerBar } from "./components/PlayerBar.js";
import { QueuePanel } from "./components/QueuePanel.js";
import { SessionPanel } from "./components/SessionPanel.js";
import { SettingsSheet } from "./components/SettingsSheet.js";
import { SignInSheet } from "./components/SignInSheet.js";
import { Sidebar } from "./components/Sidebar.js";
import { audioEngine } from "./lib/audio-engine.js";
import { storedToken } from "./lib/hub-client.js";
import { useLibrary } from "./lib/library-store.js";
import { nodeCacheStatus, nodeHealth } from "./lib/node-client.js";
import { listCached } from "./lib/offline-cache.js";
import { usePlayer } from "./lib/player-store.js";
import { useSession } from "./lib/session-store.js";
import type { Route } from "./lib/routes.js";
import { ArtistView } from "./views/ArtistView.js";
import { CollectionView } from "./views/CollectionView.js";
import { GroupsView } from "./views/GroupsView.js";
import { HomeView } from "./views/HomeView.js";
import { PlaylistView } from "./views/PlaylistView.js";
import { SearchView } from "./views/SearchView.js";

export default function App() {
  const [route, setRoute] = useState<Route>({ name: "home" });
  const [history, setHistory] = useState<Route[]>([]);
  const [future, setFuture] = useState<Route[]>([]);
  const [sessionPanelOpen, setSessionPanelOpen] = useState(false);
  const [pairingOpen, setPairingOpen] = useState(false);
  const [queueOpen, setQueueOpen] = useState(false);
  const [signInOpen, setSignInOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [addingTrack, setAddingTrack] = useState<Track | null>(null);

  const sessionConnected = useSession((s) => s.connected);
  const playerError = usePlayer((s) => s.error);
  const { user, playlistById, error: libraryError, refresh } = useLibrary();

  const peerStatus = useAutoPairing();
  const health = useNodeHealth(peerStatus);
  const cacheStates = useCacheStates(health?.ok === true);

  useAudioEngine();
  useLibrarySync();

  // まだ誰でもないなら名前を決めてもらう。共有には名前が要る。
  useEffect(() => {
    if (!storedToken()) setSignInOpen(true);
  }, []);

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
  const nodeOnline = health?.ok === true;

  /** 曲の情報からアルバムやアーティストのページへ移る。 */
  const openCollection = (kind: CollectionKind, id: string, title: string) =>
    navigate({ name: "collection", kind, id, title });

  const content = useMemo(() => {
    switch (route.name) {
      case "home":
        return <HomeView onNavigate={navigate} />;
      case "search":
        return (
          <SearchView
            cacheStates={cacheStates}
            health={health}
            onOpenCollection={openCollection}
            onAddTo={setAddingTrack}
          />
        );
      case "groups":
        return <GroupsView onNavigate={navigate} />;
      case "collection":
        // アーティストは並べ方が違う。曲だけでなく、まとまりごと見せたい。
        return route.kind === "artist" ? (
          <ArtistView
            id={route.id}
            fallbackTitle={route.title}
            cacheStates={cacheStates}
            onOpenCollection={openCollection}
            onAddTo={setAddingTrack}
          />
        ) : (
          <CollectionView
            kind={route.kind}
            id={route.id}
            fallbackTitle={route.title}
            cacheStates={cacheStates}
            onOpenCollection={openCollection}
            onAddTo={setAddingTrack}
          />
        );
      case "playlist": {
        const playlist = playlistById(route.playlistId);
        if (!playlist) {
          return <div className="p-6 pt-24 text-ink-muted">見つかりません</div>;
        }
        return (
          <PlaylistView
            playlist={playlist}
            cacheStates={cacheStates}
            onOpenCollection={openCollection}
            onLeave={() => navigate({ name: "home" })}
          />
        );
      }
    }
  }, [route, health, cacheStates, playlistById]);

  const banner = playerError ?? libraryError ?? (health && !health.resolverReady ? health.resolverMessage : null);

  return (
    /*
     * 上端はノッチを避けて押し下げる。
     * ホーム画面から起動した場合は表示領域が既に避けているので、
     * pad-top-safe 側で足さないようにしてある。
     * 下端は画面に接する下部ナビが自分で避ける。
     */
    <div className="pad-top-safe flex h-full flex-col bg-base">
      <div className="flex min-h-0 flex-1 gap-2 p-2">
        <div className="hidden md:block">
          <Sidebar route={route} onNavigate={navigate} />
        </div>

        <main className="relative flex min-w-0 flex-1 flex-col overflow-hidden rounded-lg bg-surface">
          <header className="absolute inset-x-0 top-0 z-10 flex items-center justify-between gap-4 bg-surface/70 px-4 py-3 backdrop-blur sm:px-6">
            {/* 履歴の前後移動は下部ナビで足りるので、狭い画面では出さない。 */}
            <div className="hidden items-center gap-2 md:flex">
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
              <button
                type="button"
                onClick={() => setPairingOpen(true)}
                className="flex items-center gap-1.5 rounded-full bg-base/60 px-3 py-1.5 text-xs text-ink-muted transition hover:text-ink"
                title={
                  nodeOnline
                    ? "自分の PC に接続しています"
                    : "自分の PC に接続できていません。タップしてつなぐ"
                }
              >
                {nodeOnline ? (
                  <Wifi className="size-3.5 text-accent" />
                ) : (
                  <WifiOff className="size-3.5 text-ink-faint" />
                )}
                <span className="hidden sm:inline">{nodeOnline ? "自分の PC" : "つなぐ"}</span>
              </button>
              <button
                type="button"
                onClick={() => (user ? setSettingsOpen(true) : setSignInOpen(true))}
                className="grid size-8 place-items-center rounded-full bg-surface-3 text-xs font-semibold transition hover:bg-line"
                title={user ? user.displayName : "名前を決める"}
              >
                {user?.displayName.slice(0, 1) ?? "?"}
              </button>
            </div>
          </header>

          {/* 取得系が壊れたら黙って無音にせず、理由を出す。 */}
          {banner && (
            <div className="absolute inset-x-0 top-14 z-10 mx-4 flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200 sm:mx-6">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
              <span>{banner}</span>
            </div>
          )}

          <div className="scroll-area min-h-0 flex-1">{content}</div>
        </main>

        {panelOpen && (
          <div className="hidden lg:block">
            <SessionPanel onClose={() => setSessionPanelOpen(false)} />
          </div>
        )}

        {queueOpen && !panelOpen && (
          <div className="hidden lg:block">
            <QueuePanel onClose={() => setQueueOpen(false)} />
          </div>
        )}
      </div>

      {/* 狭い画面では覆いかぶせる。横に並べる余地がない。 */}
      {panelOpen && (
        <div className="fixed inset-0 z-20 bg-base/95 p-2 lg:hidden">
          <SessionPanel onClose={() => setSessionPanelOpen(false)} fullWidth />
        </div>
      )}

      {queueOpen && !panelOpen && (
        <div className="fixed inset-0 z-20 bg-base/95 p-2 lg:hidden">
          <QueuePanel onClose={() => setQueueOpen(false)} fullWidth />
        </div>
      )}

      <PlayerBar
        sessionPanelOpen={panelOpen}
        onToggleSessionPanel={() => setSessionPanelOpen((open) => !open)}
        onOpenCollection={openCollection}
        onToggleQueue={() => setQueueOpen((open) => !open)}
        queueOpen={queueOpen}
      />

      <MobileNav
        route={route}
        onNavigate={navigate}
        onOpenSession={() => setSessionPanelOpen(true)}
      />

      {pairingOpen && <PairingSheet onClose={() => setPairingOpen(false)} />}
      {signInOpen && (
        <SignInSheet
          onClose={() => setSignInOpen(false)}
          dismissible={Boolean(user)}
        />
      )}
      {settingsOpen && (
        <SettingsSheet
          onClose={() => setSettingsOpen(false)}
          onOpenPairing={() => setPairingOpen(true)}
          nodeOnline={nodeOnline}
        />
      )}
      {addingTrack && (
        <AddToPlaylistSheet track={addingTrack} onClose={() => setAddingTrack(null)} />
      )}
      {layoutProbeEnabled() && <LayoutProbe />}
    </div>
  );
}

/**
 * 再生エンジンを立ち上げ、最初のユーザー操作で再生許可を取る。
 *
 * iOS は操作を伴わない再生を許さないので、
 * どこでもいいから最初に触れた瞬間を捕まえて許可を得ておく。
 */
function useAudioEngine(): void {
  useEffect(() => {
    audioEngine.init();

    const unlock = () => audioEngine.unlock();
    const options = { once: true, capture: true } as const;
    document.addEventListener("pointerdown", unlock, options);
    document.addEventListener("touchstart", unlock, options);
    document.addEventListener("keydown", unlock, options);

    return () => {
      document.removeEventListener("pointerdown", unlock, options);
      document.removeEventListener("touchstart", unlock, options);
      document.removeEventListener("keydown", unlock, options);
    };
  }, []);
}

/** 書棚の中身を取り込む。他の端末で足した曲もここで入ってくる。 */
function useLibrarySync(): void {
  const refresh = useLibrary((s) => s.refresh);

  useEffect(() => {
    void refresh();
    // 共有している相手が足したものを、開いたままでも拾えるようにする。
    const timer = setInterval(() => void refresh(), 30_000);
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, [refresh]);
}

/**
 * 自分の PC が生きているかを定期的に見る。落ちたら UI に出す。
 * 直結の状態が変わったら経路も変わるので、その時点で確かめ直す。
 */
function useNodeHealth(peerStatus: string): NodeHealth | null {
  const [health, setHealth] = useState<NodeHealth | null>(null);

  useEffect(() => {
    let cancelled = false;

    const check = async () => {
      try {
        const result = await nodeHealth();
        if (!cancelled) setHealth(result);
      } catch {
        if (!cancelled) setHealth(null);
      }
    };

    void check();
    const timer = setInterval(check, 15_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [peerStatus]);

  return health;
}

/**
 * どの曲がすぐ鳴らせるか。
 * PC 側に置いてあるものと、この端末に残してあるものを合わせて見せる。
 */
function useCacheStates(online: boolean): Record<string, CacheState> {
  const [states, setStates] = useState<Record<string, CacheState>>({});

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      const merged: Record<string, CacheState> = {};

      // 端末に残っているものは、PC が落ちていても鳴らせる。
      for (const trackId of await listCached()) merged[trackId] = "ready";

      if (online) {
        try {
          const { entries } = await nodeCacheStatus();
          for (const entry of entries) {
            // 手元にあるものを「取得中」で上書きしない。
            if (merged[entry.trackId] === "ready" && entry.state !== "ready") continue;
            merged[entry.trackId] = entry.state;
          }
        } catch {
          // 取れなくても再生自体はできる。次の周期で取り直す。
        }
      }

      if (!cancelled) setStates(merged);
    };

    void load();
    const timer = setInterval(load, 5_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [online]);

  return states;
}
