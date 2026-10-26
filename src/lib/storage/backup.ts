import type { Channel, PersonalPlaylist, Source } from '../types';
import { MY_CHANNELS_ID } from '../types';
import { identityName, normalizeName } from '../m3u/normalize';
import { safeHttpUrl } from '../m3u/url';
import { sanitizePrefs, type Prefs } from './prefs';
import type { Snapshot } from './repository';

export const BACKUP_FORMAT = 'hasi-iptv-backup';
export const BACKUP_VERSION = 1;
export const MAX_BACKUP_BYTES = 40 * 1024 * 1024;
const MAX_PERSONAL_ENTRIES = 5000;

export type PersonalEntry = { name: string; providerId?: string; group?: string };

export type PersonalBackup = {
  format: typeof BACKUP_FORMAT;
  version: number;
  kind: 'personal';
  createdAt: string;
  settings: Pick<Prefs, 'showLogos' | 'engine' | 'autoFullscreen'>;
  playlist: { name: string; entries: PersonalEntry[] };
};

export type FullBackup = {
  format: typeof BACKUP_FORMAT;
  version: number;
  kind: 'full';
  createdAt: string;
  settings: Pick<Prefs, 'showLogos' | 'engine' | 'autoFullscreen'>;
  data: Snapshot;
};

export type Backup = PersonalBackup | FullBackup;

export function createPersonalBackup(playlist: PersonalPlaylist, channels: Map<string, Channel>, prefs: Prefs): PersonalBackup {
  const entries: PersonalEntry[] = [];
  for (const id of playlist.channelIds) {
    const c = channels.get(id);
    if (!c) continue;
    const e: PersonalEntry = { name: c.name };
    if (c.providerId) e.providerId = c.providerId;
    if (c.group) e.group = c.group;
    entries.push(e);
  }
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    kind: 'personal',
    createdAt: new Date().toISOString(),
    settings: { showLogos: prefs.showLogos, engine: prefs.engine, autoFullscreen: prefs.autoFullscreen },
    playlist: { name: playlist.name, entries },
  };
}

export function createFullBackup(snapshot: Snapshot, prefs: Prefs): FullBackup {
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    kind: 'full',
    createdAt: new Date().toISOString(),
    settings: { showLogos: prefs.showLogos, engine: prefs.engine, autoFullscreen: prefs.autoFullscreen },
    data: snapshot,
  };
}

export class BackupError extends Error {
  name = 'BackupError';
}

const str = (v: unknown, max = 500): v is string => typeof v === 'string' && v.length <= max;

/** Parses and validates backup JSON. Throws BackupError with a user-facing message. */
export function parseBackup(text: string): Backup {
  if (text.length > MAX_BACKUP_BYTES) throw new BackupError('Backup file is too large.');
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new BackupError('This file is not valid JSON.');
  }
  const b = raw as Record<string, unknown>;
  if (!b || b.format !== BACKUP_FORMAT) throw new BackupError('This is not a Hasi IPTV backup file.');
  if (typeof b.version !== 'number' || b.version > BACKUP_VERSION) {
    throw new BackupError('This backup was made by a newer version of the app.');
  }
  const settings = sanitizePrefs(b.settings as Partial<Prefs>);
  const pickedSettings = { showLogos: settings.showLogos, engine: settings.engine, autoFullscreen: settings.autoFullscreen };
  const createdAt = str(b.createdAt, 40) ? b.createdAt : '';

  if (b.kind === 'personal') {
    const pl = b.playlist as { name?: unknown; entries?: unknown } | undefined;
    if (!pl || !Array.isArray(pl.entries)) throw new BackupError('Backup has no channel list.');
    if (pl.entries.length > MAX_PERSONAL_ENTRIES) throw new BackupError('Backup contains too many channels.');
    const entries: PersonalEntry[] = [];
    for (const e of pl.entries as Record<string, unknown>[]) {
      if (!e || !str(e.name, 300) || !e.name.trim()) throw new BackupError('Backup contains an invalid channel entry.');
      const entry: PersonalEntry = { name: e.name };
      if (str(e.providerId, 300) && e.providerId) entry.providerId = e.providerId;
      if (str(e.group, 300) && e.group) entry.group = e.group;
      entries.push(entry);
    }
    return {
      format: BACKUP_FORMAT,
      version: BACKUP_VERSION,
      kind: 'personal',
      createdAt,
      settings: pickedSettings,
      playlist: { name: str(pl.name, 100) && pl.name ? pl.name : 'My Channels', entries },
    };
  }

  if (b.kind === 'full') {
    const d = b.data as Partial<Snapshot> | undefined;
    if (!d || !Array.isArray(d.sources) || !Array.isArray(d.channels) || !Array.isArray(d.playlists)) {
      throw new BackupError('Full backup is missing data.');
    }
    const sources: Source[] = d.sources.map((s) => {
      if (!s || !str(s.id, 100) || (s.kind !== 'url' && s.kind !== 'file')) throw new BackupError('Backup has an invalid source.');
      const out: Source = { id: s.id, name: str(s.name, 200) ? s.name : 'Source', kind: s.kind };
      if (s.url) {
        const u = safeHttpUrl(String(s.url));
        if (!u) throw new BackupError('Backup has an invalid source URL.');
        out.url = u;
      }
      if (str(s.fileName, 300)) out.fileName = s.fileName;
      if (str(s.lastSuccessfulRefreshAt, 40)) out.lastSuccessfulRefreshAt = s.lastSuccessfulRefreshAt;
      return out;
    });
    const sourceIds = new Set(sources.map((s) => s.id));
    const channels: Channel[] = d.channels.map((c, i) => {
      if (!c || !str(c.id, 100) || !sourceIds.has(c.sourceId) || !str(c.name, 300)) throw new BackupError('Backup has an invalid channel.');
      const streamUrl = c.streamUrl ? safeHttpUrl(String(c.streamUrl)) : '';
      if (streamUrl === null) throw new BackupError(`Backup channel “${c.name}” has an unsupported URL.`);
      const out: Channel = {
        id: c.id,
        sourceId: c.sourceId,
        name: c.name,
        normalizedName: normalizeName(c.name),
        streamUrl,
        availability: c.availability === 'missing' || c.availability === 'needs-review' ? c.availability : 'available',
        order: typeof c.order === 'number' ? c.order : i,
      };
      if (str(c.providerId, 300) && c.providerId) out.providerId = c.providerId;
      if (str(c.group, 300) && c.group) out.group = c.group;
      if (c.logoUrl) {
        const logo = safeHttpUrl(String(c.logoUrl));
        if (logo) out.logoUrl = logo;
      }
      if (Array.isArray(c.directives)) out.directives = c.directives.filter((x) => str(x, 50)).slice(0, 10);
      return out;
    });
    const channelIds = new Set(channels.map((c) => c.id));
    const playlists: PersonalPlaylist[] = d.playlists.map((p) => {
      if (!p || !str(p.id, 100) || !Array.isArray(p.channelIds)) throw new BackupError('Backup has an invalid playlist.');
      return {
        id: p.id,
        name: str(p.name, 100) ? p.name : 'My Channels',
        channelIds: Array.from(new Set(p.channelIds.filter((id) => typeof id === 'string' && channelIds.has(id)))),
      };
    });
    return { format: BACKUP_FORMAT, version: BACKUP_VERSION, kind: 'full', createdAt, settings: pickedSettings, data: { sources, channels, playlists } };
  }
  throw new BackupError('Unknown backup type.');
}

export type PersonalRestorePlan = {
  /** Ordered channel IDs for the restored playlist. */
  channelIds: string[];
  /** Placeholder channels to create for entries not present in the catalogue. */
  placeholders: Channel[];
  matched: number;
  unmatched: number;
};

/**
 * Matches personal-backup entries against the current catalogue. Unmatched
 * entries become "missing" placeholders so a later source import can match them.
 */
export function planPersonalRestore(
  backup: PersonalBackup,
  catalogue: Channel[],
  sourceId: string,
  newId: () => string,
): PersonalRestorePlan {
  const byPid = new Map<string, Channel[]>();
  const byNameGroup = new Map<string, Channel[]>();
  const byName = new Map<string, Channel[]>();
  const push = (m: Map<string, Channel[]>, k: string, c: Channel) => {
    const l = m.get(k);
    if (l) l.push(c);
    else m.set(k, [c]);
  };
  for (const c of catalogue) {
    const n = identityName(c.name);
    if (c.providerId) push(byPid, `${c.providerId}\u0000${n}`, c);
    push(byNameGroup, `${n}\u0000${(c.group ?? '').toLowerCase()}`, c);
    push(byName, n, c);
  }
  const used = new Set<string>();
  const channelIds: string[] = [];
  const placeholders: Channel[] = [];
  let matched = 0;
  let order = catalogue.length;
  for (const e of backup.playlist.entries) {
    const n = identityName(e.name);
    const candidates = [
      e.providerId ? byPid.get(`${e.providerId}\u0000${n}`) : undefined,
      byNameGroup.get(`${n}\u0000${(e.group ?? '').toLowerCase()}`),
      byName.get(n),
    ];
    let pick: Channel | undefined;
    for (const list of candidates) {
      const free = list?.filter((c) => !used.has(c.id));
      if (free && free.length === 1) {
        pick = free[0];
        break;
      }
      if (free && free.length > 1) break; // ambiguous: never guess
    }
    if (pick) {
      used.add(pick.id);
      channelIds.push(pick.id);
      matched++;
    } else {
      const ph: Channel = {
        id: newId(),
        sourceId,
        name: e.name,
        normalizedName: normalizeName(e.name),
        streamUrl: '',
        availability: 'missing',
        order: order++,
      };
      if (e.providerId) ph.providerId = e.providerId;
      if (e.group) ph.group = e.group;
      placeholders.push(ph);
      channelIds.push(ph.id);
    }
  }
  return { channelIds, placeholders, matched, unmatched: placeholders.length };
}

export function emptyPlaylist(): PersonalPlaylist {
  return { id: MY_CHANNELS_ID, name: 'My Channels', channelIds: [] };
}
