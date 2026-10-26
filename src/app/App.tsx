import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Channel, PersonalPlaylist, Source } from '../lib/types';
import { openRepository } from '../lib/storage/indexedDb';
import { describeStorageError, type Repository } from '../lib/storage/repository';
import { emptyPlaylist } from '../lib/storage/backup';
import { loadPrefs, savePrefs, type Prefs } from '../lib/storage/prefs';
import { isTextEntry, navKey, recordKey } from '../lib/navigation/keys';
import { focusById, focusDefault, moveFocus } from '../lib/navigation/focus';
import { moveItem, stepInList } from '../lib/navigation/activeList';
import { createController, type PlaybackController } from '../features/player/controller';
import { exitFullscreen, fullscreenElement, onFullscreenChange, requestFullscreen } from '../features/player/fullscreen';
import { PlayerOverlay } from '../features/player/PlayerOverlay';
import { MyChannels } from '../features/my-channels/MyChannels';
import { AllChannels } from '../features/catalogue/AllChannels';
import { Settings } from '../features/settings/Settings';
import { StreamLab } from '../features/settings/StreamLab';
import type { ImportOutcome } from '../features/settings/importer';
import { closeTopDialog } from './Dialog';
import { AppContext, usePlayback, type ActiveList, type AppApi, type CatalogueView, type ListKind, type Notice, type Screen } from './context';

type Boot = {
  repo: Repository;
  warning?: string;
  sources: Source[];
  channels: Channel[];
  playlist: PersonalPlaylist;
};

export function App() {
  const [boot, setBoot] = useState<Boot | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { repo, warning } = await openRepository();
      let snapshot = { sources: [] as Source[], channels: [] as Channel[], playlists: [] as PersonalPlaylist[] };
      let loadWarning = warning;
      try {
        snapshot = await repo.loadAll();
      } catch (err) {
        loadWarning = `Saved data could not be read: ${describeStorageError(err)}`;
      }
      const skipped = (repo as { skippedRecords?: number }).skippedRecords;
      if (skipped) loadWarning = `${skipped} corrupt saved record(s) were skipped.`;
      if (cancelled) return;
      setBoot({
        repo,
        warning: loadWarning,
        sources: snapshot.sources,
        channels: snapshot.channels,
        playlist: snapshot.playlists[0] ?? emptyPlaylist(),
      });
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!boot) return <div className="boot">Loading…</div>;
  return <Shell boot={boot} />;
}

function Shell({ boot }: { boot: Boot }) {
  const { repo } = boot;
  const [sources, setSources] = useState(boot.sources);
  const [channels, setChannels] = useState(boot.channels);
  const [playlist, setPlaylist] = useState(boot.playlist);
  const [prefs, setPrefsState] = useState<Prefs>(loadPrefs);
  const [screen, setScreen] = useState<Screen>('my');
  const [activeList, setActiveList] = useState<ActiveList>();
  const [catalogueView, setCatalogueViewState] = useState<CatalogueView>(() => prefs.catalogue);
  const [lastImport, setLastImport] = useState<ImportOutcome>();
  const [notice, setNotice] = useState<Notice | undefined>(boot.warning ? { kind: 'error', text: boot.warning } : undefined);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [controller, setController] = useState<PlaybackController | null>(null);

  const appRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const returnScreen = useRef<Screen>('my');
  const focusMemory = useRef<Partial<Record<Screen, string>>>({});
  const screenRef = useRef(screen);
  screenRef.current = screen;
  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;

  const channelMap = useMemo(() => new Map(channels.map((c) => [c.id, c])), [channels]);
  const savedSet = useMemo(() => new Set(playlist.channelIds), [playlist]);
  const source = sources[0];
  const playback = usePlayback(controller);

  // One video element and one controller for the app's lifetime.
  useEffect(() => {
    const c = createController(videoRef.current!);
    c.enginePreference = prefsRef.current.engine;
    setController(c);
    return () => c.destroy();
  }, []);

  useEffect(() => {
    if (controller) controller.enginePreference = prefs.engine;
  }, [controller, prefs.engine]);

  useEffect(() => onFullscreenChange(() => setIsFullscreen(!!fullscreenElement())), []);

  // Debounced preference persistence (includes catalogue view state).
  const prefsDirty = useRef(false);
  useEffect(() => {
    if (!prefsDirty.current) return;
    const t = setTimeout(() => {
      if (!savePrefs({ ...prefsRef.current, catalogue: catalogueView })) {
        // Preferences are a convenience; failure only means they are not remembered.
      }
    }, 400);
    return () => clearTimeout(t);
  }, [prefs, catalogueView]);

  const setPrefs = useCallback((patch: Partial<Prefs>) => {
    prefsDirty.current = true;
    setPrefsState((p) => ({ ...p, ...patch }));
  }, []);

  const setCatalogueView = useCallback((patch: Partial<CatalogueView>) => {
    prefsDirty.current = true;
    setCatalogueViewState((v) => ({ ...v, ...patch }));
  }, []);

  // Remember the focused element per screen for restoration.
  useEffect(() => {
    const onFocusIn = (e: FocusEvent) => {
      const el = (e.target as HTMLElement | null)?.closest?.('[data-focus-id]') as HTMLElement | null;
      const id = el?.dataset.focusId;
      if (!id) return;
      const s = screenRef.current;
      focusMemory.current[s] = id;
      if (s === 'my' && id.startsWith('ch:')) {
        const channelId = id.slice(3).split('|')[0];
        if (prefsRef.current.lastFocusedMyChannel !== channelId) setPrefs({ lastFocusedMyChannel: channelId });
      }
    };
    document.addEventListener('focusin', onFocusIn);
    return () => document.removeEventListener('focusin', onFocusIn);
  }, [setPrefs]);

  const notify = useCallback((n: Notice | undefined) => setNotice(n), []);

  const go = useCallback((next: Screen) => {
    if (next === 'player' && controller?.getState().status === 'idle') return;
    if (next === 'player' && screenRef.current !== 'player') returnScreen.current = screenRef.current;
    setScreen(next);
  }, [controller]);

  const leavePlayer = useCallback(() => {
    const target = returnScreen.current;
    const playingId = controller?.getState().channel?.id;
    if (playingId && target !== 'lab') focusMemory.current[target] = `ch:${playingId}|main`;
    setScreen(target);
  }, [controller]);

  const back = useCallback((): boolean => {
    if (closeTopDialog()) return true;
    const s = screenRef.current;
    if (s === 'player') {
      leavePlayer();
      return true;
    }
    if (s === 'lab') {
      setScreen('settings');
      return true;
    }
    if (s !== 'my') {
      setScreen('my');
      return true;
    }
    return false;
  }, [leavePlayer]);
  const backRef = useRef(back);
  backRef.current = back;

  // Restore focus when the screen changes, unless the screen already focused something itself.
  useEffect(() => {
    const t = setTimeout(() => {
      const active = document.activeElement;
      const app = appRef.current;
      if (active && active !== document.body && app?.contains(active) && (active as HTMLElement).getClientRects().length) return;
      if (!focusById(focusMemory.current[screen])) focusDefault();
    }, 0);
    return () => clearTimeout(t);
  }, [screen]);

  // Global remote/keyboard handling.
  const lastKeyBack = useRef(0);
  useEffect(() => {
    const onKeyCapture = (e: KeyboardEvent) => {
      recordKey(e);
      // Holding OK must not activate a control repeatedly.
      if (e.repeat && navKey(e) === 'ok') {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      const k = navKey(e);
      if (!k) return;
      const active = document.activeElement;
      const editing = isTextEntry(active);
      if (k === 'back') {
        if (editing && e.key === 'Backspace') return;
        if (backRef.current()) {
          lastKeyBack.current = Date.now();
          e.preventDefault();
        }
        return;
      }
      if (k === 'ok') return; // Semantic buttons activate natively on Enter.
      if (editing && (k === 'left' || k === 'right')) return;
      moveFocus(k);
      e.preventDefault(); // Never let arrows scroll the page behind the focus.
    };
    window.addEventListener('keydown', onKeyCapture, true);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKeyCapture, true);
      window.removeEventListener('keydown', onKey);
    };
  }, []);

  // Some TV browsers map the physical Back button to history navigation.
  // Keep one guard entry so Back first closes overlays / returns to My Channels.
  useEffect(() => {
    try {
      history.pushState({ hasiGuard: true }, '');
    } catch {
      return;
    }
    const onPop = () => {
      const recentlyHandled = Date.now() - lastKeyBack.current < 700;
      if (recentlyHandled || backRef.current()) {
        try {
          history.pushState({ hasiGuard: true }, '');
        } catch {
          /* ignore */
        }
      }
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const appRoot = useCallback(() => appRef.current, []);

  const enterFullscreenIfWanted = useCallback(() => {
    // Must run synchronously in the user's click/Enter handler, before any network wait.
    if (prefsRef.current.autoFullscreen && appRef.current && !fullscreenElement()) void requestFullscreen(appRef.current);
  }, []);

  const playChannel = useCallback(
    (channelId: string, kind: ListKind, ids: string[]) => {
      const ch = channelMap.get(channelId);
      if (!ch || !controller) return;
      enterFullscreenIfWanted();
      setActiveList({ kind, ids, index: ids.indexOf(channelId) });
      const current = controller.getState();
      // Re-selecting the channel that is already playing just opens the player.
      if (current.channel?.id !== ch.id || current.status === 'idle' || current.status === 'error') controller.play(ch);
      go('player');
    },
    [channelMap, controller, go, enterFullscreenIfWanted],
  );

  const playLab = useCallback(
    (url: string, openPlayer: boolean) => {
      if (!controller) return;
      setActiveList({ kind: 'lab', ids: ['lab'], index: 0 });
      controller.play({ id: 'lab', name: 'Stream Lab test', streamUrl: url });
      if (openPlayer) go('player');
    },
    [controller, go],
  );

  const step = useCallback(
    (dir: 1 | -1) => {
      if (!controller || !activeList || activeList.kind === 'lab') return;
      const current = controller.getState().channel;
      const nextId = stepInList(activeList.ids, current?.id, activeList.index, dir, (id) => !!channelMap.get(id)?.streamUrl);
      const next = nextId ? channelMap.get(nextId) : undefined;
      if (!next) return;
      setActiveList({ ...activeList, index: activeList.ids.indexOf(next.id) });
      controller.play(next, 350); // Short delay so rapid zapping only loads the final pick.
    },
    [activeList, channelMap, controller],
  );

  // Keep the My Channels play order in sync with edits made while watching.
  useEffect(() => {
    setActiveList((list) => {
      if (!list || list.kind !== 'my') return list;
      const currentId = controller?.getState().channel?.id;
      const at = currentId ? playlist.channelIds.indexOf(currentId) : -1;
      return { kind: 'my', ids: playlist.channelIds, index: at >= 0 ? at : list.index };
    });
  }, [playlist, controller]);

  const persistPlaylist = useCallback(
    (next: PersonalPlaylist) => {
      setPlaylist(next);
      repo.savePlaylist(next).catch((err) => setNotice({ kind: 'error', text: `My Channels could not be saved: ${describeStorageError(err)}` }));
    },
    [repo],
  );

  const addToMy = useCallback(
    (id: string) => {
      if (playlist.channelIds.includes(id) || !channelMap.has(id)) return;
      persistPlaylist({ ...playlist, channelIds: [...playlist.channelIds, id] });
    },
    [playlist, channelMap, persistPlaylist],
  );

  const removeFromMy = useCallback(
    (id: string) => persistPlaylist({ ...playlist, channelIds: playlist.channelIds.filter((x) => x !== id) }),
    [playlist, persistPlaylist],
  );

  const moveInMy = useCallback(
    (id: string, delta: -1 | 1) => {
      const from = playlist.channelIds.indexOf(id);
      persistPlaylist({ ...playlist, channelIds: moveItem(playlist.channelIds, from, from + delta) });
    },
    [playlist, persistPlaylist],
  );

  const setPlaylistIds = useCallback(
    async (ids: string[]) => {
      const next = { ...playlist, channelIds: Array.from(new Set(ids)) };
      await repo.savePlaylist(next);
      setPlaylist(next);
    },
    [playlist, repo],
  );

  const applyImport = useCallback((o: ImportOutcome) => {
    setSources([o.source]);
    setChannels(o.channels);
    setPlaylist(o.playlist);
    setLastImport(o);
  }, []);

  const reload = useCallback(async () => {
    const snapshot = await repo.loadAll();
    setSources(snapshot.sources);
    setChannels(snapshot.channels);
    setPlaylist(snapshot.playlists[0] ?? emptyPlaylist());
    setPrefsState(loadPrefs());
  }, [repo]);

  const toggleFullscreen = useCallback(() => {
    if (fullscreenElement()) exitFullscreen();
    else if (appRef.current) {
      void requestFullscreen(appRef.current).then((ok) => {
        if (!ok) setNotice({ kind: 'info', text: 'Fullscreen was refused by the browser. Full-window mode is still active.' });
      });
    }
  }, []);

  const api: AppApi = {
    repo,
    storageWarning: repo.persistent ? undefined : boot.warning,
    source,
    channels,
    channelMap,
    playlist,
    savedSet,
    prefs,
    setPrefs,
    screen,
    go,
    back,
    activeList,
    catalogueView,
    setCatalogueView,
    lastImport,
    setLastImport,
    notify,
    playChannel,
    playLab,
    step,
    addToMy,
    removeFromMy,
    moveInMy,
    setPlaylistIds,
    applyImport,
    reload,
    toggleFullscreen,
    isFullscreen,
    controller,
    appRoot,
    focusMemory: focusMemory.current,
  };

  const playing = playback.status !== 'idle' ? playback.channel : undefined;
  const mode = screen === 'player' ? 'full' : playing ? 'mini' : 'hidden';
  const navScreen = screen === 'lab' ? 'settings' : screen;

  return (
    <AppContext.Provider value={api}>
      <div className={`app screen-${screen}`} ref={appRef}>
        {screen !== 'player' && (
          <>
            <nav className="sidebar" aria-label="Main">
              <div className="brand">Hasi IPTV</div>
              <NavButton id="my" label="My Channels" active={navScreen === 'my'} onClick={() => go('my')} />
              <NavButton id="all" label="All Channels" active={navScreen === 'all'} onClick={() => go('all')} />
              <NavButton id="settings" label="Settings" active={navScreen === 'settings'} onClick={() => go('settings')} />
              {playing && (
                <button type="button" className="nav-btn now-playing" data-focus-id="nav:now" onClick={() => go('player')}>
                  <span className="now-label">▶ Now playing</span>
                  <span className="now-name">{playing.name}</span>
                </button>
              )}
            </nav>
            <main className="main">
              {notice && (
                <div className={`notice notice-${notice.kind}`} role="status">
                  <span>{notice.text}</span>
                  <button type="button" className="btn btn-small" onClick={() => setNotice(undefined)}>
                    Dismiss
                  </button>
                </div>
              )}
              {screen === 'my' && <MyChannels />}
              {screen === 'all' && <AllChannels />}
              {screen === 'settings' && <Settings />}
              {screen === 'lab' && <StreamLab />}
            </main>
          </>
        )}
        <div className={`player-root mode-${mode}`} data-nav-scope={mode === 'full' ? '' : undefined}>
          <video ref={videoRef} className="video" playsInline preload="none" />
          {mode === 'full' && <PlayerOverlay onLeave={leavePlayer} />}
        </div>
      </div>
    </AppContext.Provider>
  );
}

function NavButton({ id, label, active, onClick }: { id: string; label: string; active: boolean; onClick: () => void }) {
  return (
    <button type="button" className={`nav-btn${active ? ' active' : ''}`} aria-current={active ? 'page' : undefined} data-focus-id={`nav:${id}`} onClick={onClick}>
      {label}
    </button>
  );
}
