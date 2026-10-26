export type EnginePreference = 'auto' | 'native' | 'hls.js';

export type Prefs = {
  showLogos: boolean;
  engine: EnginePreference;
  autoFullscreen: boolean;
  lastFocusedMyChannel?: string;
  catalogue: { query: string; group: string; page: number };
};

export const DEFAULT_PREFS: Prefs = {
  showLogos: true,
  engine: 'auto',
  autoFullscreen: true,
  catalogue: { query: '', group: '', page: 0 },
};

const KEY = 'hasi-iptv:prefs:v1';

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null; // Accessing localStorage can throw when site data is blocked.
  }
}

export function loadPrefs(): Prefs {
  try {
    const raw = storage()?.getItem(KEY);
    if (!raw) return DEFAULT_PREFS;
    const parsed = JSON.parse(raw) as Partial<Prefs>;
    return sanitizePrefs(parsed);
  } catch {
    return DEFAULT_PREFS;
  }
}

export function sanitizePrefs(p: Partial<Prefs> | null | undefined): Prefs {
  const c = (p?.catalogue ?? {}) as Partial<Prefs['catalogue']>;
  return {
    showLogos: typeof p?.showLogos === 'boolean' ? p.showLogos : DEFAULT_PREFS.showLogos,
    engine: p?.engine === 'native' || p?.engine === 'hls.js' ? p.engine : 'auto',
    autoFullscreen: typeof p?.autoFullscreen === 'boolean' ? p.autoFullscreen : DEFAULT_PREFS.autoFullscreen,
    lastFocusedMyChannel: typeof p?.lastFocusedMyChannel === 'string' ? p.lastFocusedMyChannel : undefined,
    catalogue: {
      query: typeof c.query === 'string' ? c.query.slice(0, 100) : '',
      group: typeof c.group === 'string' ? c.group.slice(0, 200) : '',
      page: typeof c.page === 'number' && c.page >= 0 ? Math.floor(c.page) : 0,
    },
  };
}

/** Returns false when the preference could not be persisted (quota, blocked storage). */
export function savePrefs(prefs: Prefs): boolean {
  try {
    const s = storage();
    if (!s) return false;
    s.setItem(KEY, JSON.stringify(prefs));
    return true;
  } catch {
    return false;
  }
}

export function clearPrefs(): void {
  try {
    storage()?.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
