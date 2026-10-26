import { createContext, useContext, useSyncExternalStore } from 'react';
import type { Channel, PersonalPlaylist, Source } from '../lib/types';
import type { Prefs } from '../lib/storage/prefs';
import type { Repository } from '../lib/storage/repository';
import type { PlaybackController, PlaybackState } from '../features/player/controller';
import type { ImportOutcome } from '../features/settings/importer';

export type Screen = 'my' | 'all' | 'settings' | 'lab' | 'player';
export type ListKind = 'my' | 'all' | 'lab';

export type ActiveList = { kind: ListKind; ids: string[]; index: number };

export type Notice = { kind: 'info' | 'error'; text: string };

export type CatalogueView = Prefs['catalogue'];

export type AppApi = {
  repo: Repository;
  storageWarning?: string;
  source?: Source;
  channels: Channel[];
  channelMap: Map<string, Channel>;
  playlist: PersonalPlaylist;
  savedSet: Set<string>;
  prefs: Prefs;
  setPrefs: (patch: Partial<Prefs>) => void;
  screen: Screen;
  go: (screen: Screen) => void;
  back: () => boolean;
  activeList?: ActiveList;
  catalogueView: CatalogueView;
  setCatalogueView: (patch: Partial<CatalogueView>) => void;
  lastImport?: ImportOutcome;
  setLastImport: (o: ImportOutcome | undefined) => void;
  notify: (n: Notice | undefined) => void;
  /** Called from a click/Enter handler. */
  playChannel: (channelId: string, kind: ListKind, ids: string[]) => void;
  playLab: (url: string, openPlayer: boolean) => void;
  step: (dir: 1 | -1) => void;
  addToMy: (id: string) => void;
  removeFromMy: (id: string) => void;
  moveInMy: (id: string, delta: -1 | 1) => void;
  setPlaylistIds: (ids: string[]) => Promise<void>;
  applyImport: (o: ImportOutcome) => void;
  reload: () => Promise<void>;
  toggleFullscreen: () => void;
  isFullscreen: boolean;
  controller: PlaybackController | null;
  appRoot: () => HTMLElement | null;
  /** Remembered focus ID for a screen (focus restoration). */
  focusMemory: Partial<Record<Screen, string>>;
};

export const AppContext = createContext<AppApi | null>(null);

export function useApp(): AppApi {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('AppContext missing');
  return ctx;
}

const IDLE_STATE: PlaybackState = { status: 'idle', attempt: 0, notes: [], requestId: 0 };
const noop = () => () => undefined;

export function usePlayback(controller: PlaybackController | null): PlaybackState {
  return useSyncExternalStore(controller ? controller.subscribe : noop, controller ? controller.getState : () => IDLE_STATE);
}

/** Subscribes to only the playing channel ID so list rows do not rerender on every status change. */
export function usePlayingId(controller: PlaybackController | null): string | undefined {
  return useSyncExternalStore(
    controller ? controller.subscribe : noop,
    () => {
      const s = controller?.getState();
      return s && s.status !== 'idle' ? s.channel?.id : undefined;
    },
  );
}
