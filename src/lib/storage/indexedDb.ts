import type { Channel, PersonalPlaylist, Source } from '../types';
import { MemoryRepository, StorageError, type CatalogueCommit, type Repository, type Snapshot } from './repository';

export const DB_NAME = 'hasi-iptv';
export const DB_VERSION = 1;

const STORES = { sources: 'sources', channels: 'channels', playlists: 'playlists', meta: 'meta' } as const;

/**
 * Explicit, ordered migrations. Each entry upgrades from version (index) to (index + 1).
 * Never edit an existing migration; append a new one and bump DB_VERSION.
 */
const MIGRATIONS: ((db: IDBDatabase, tx: IDBTransaction) => void)[] = [
  // 0 -> 1: initial schema
  (db) => {
    db.createObjectStore(STORES.sources, { keyPath: 'id' });
    const channels = db.createObjectStore(STORES.channels, { keyPath: 'id' });
    channels.createIndex('sourceId', 'sourceId', { unique: false });
    db.createObjectStore(STORES.playlists, { keyPath: 'id' });
    db.createObjectStore(STORES.meta, { keyPath: 'key' });
  },
];

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

/**
 * Runs synchronous writes inside a transaction. If any request throws (e.g. a
 * DataError), the whole transaction is aborted so nothing is partially applied.
 */
async function writeAll(tx: IDBTransaction, writes: () => void): Promise<void> {
  const finished = done(tx);
  try {
    writes();
  } catch (err) {
    try {
      tx.abort();
    } catch {
      /* already finished */
    }
    finished.catch(() => undefined);
    throw err;
  }
  await finished;
}

export const WRITE_BATCH = 400;

/**
 * Issues many writes in one transaction, a batch at a time. The next batch is
 * started from the last request's success callback, which keeps the
 * transaction alive (still atomic) while letting the browser handle input and
 * paint between batches instead of cloning 10k+ records in one long task.
 */
async function writeBatched(tx: IDBTransaction, ops: (() => IDBRequest)[]): Promise<void> {
  const finished = done(tx);
  let i = 0;
  const next = () => {
    try {
      const end = Math.min(ops.length, i + WRITE_BATCH);
      let last: IDBRequest | undefined;
      for (; i < end; i++) last = ops[i]();
      if (last && i < ops.length) last.onsuccess = next;
    } catch (err) {
      try {
        tx.abort();
      } catch {
        /* already finished */
      }
      failure = err;
    }
  };
  let failure: unknown;
  next();
  try {
    await finished;
  } catch (err) {
    throw failure ?? err;
  }
  if (failure) throw failure;
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new StorageError('Transaction failed'));
    tx.onabort = () => reject(tx.error ?? new StorageError('Transaction aborted'));
  });
}

export function openDatabase(factory: IDBFactory = indexedDB, timeoutMs = 8000): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    let open: IDBOpenDBRequest;
    try {
      open = factory.open(DB_NAME, DB_VERSION);
    } catch (err) {
      reject(err);
      return;
    }
    // Some embedded browsers never fire success/error when storage is disabled.
    const timer = setTimeout(() => reject(new StorageError('Opening browser storage timed out')), timeoutMs);
    open.onupgradeneeded = (event) => {
      const db = open.result;
      const tx = open.transaction!;
      for (let v = event.oldVersion; v < DB_VERSION; v++) MIGRATIONS[v](db, tx);
      tx.objectStore(STORES.meta).put({ key: 'schema', version: DB_VERSION, migratedAt: new Date().toISOString() });
    };
    open.onsuccess = () => {
      clearTimeout(timer);
      const db = open.result;
      db.onversionchange = () => db.close();
      resolve(db);
    };
    open.onerror = () => {
      clearTimeout(timer);
      reject(open.error);
    };
    open.onblocked = () => {
      clearTimeout(timer);
      reject(new StorageError('Storage upgrade is blocked by another open tab of this app'));
    };
  });
}

/** Drops records that fail basic shape checks instead of crashing on corrupt data. */
function validChannel(c: unknown): c is Channel {
  const x = c as Channel;
  return !!x && typeof x.id === 'string' && typeof x.sourceId === 'string' && typeof x.name === 'string' && typeof x.streamUrl === 'string';
}
function validPlaylist(p: unknown): p is PersonalPlaylist {
  const x = p as PersonalPlaylist;
  return !!x && typeof x.id === 'string' && Array.isArray(x.channelIds);
}
function validSource(s: unknown): s is Source {
  const x = s as Source;
  return !!x && typeof x.id === 'string' && (x.kind === 'url' || x.kind === 'file');
}

export class IndexedDbRepository implements Repository {
  readonly persistent = true;
  /** Number of corrupt records skipped during the last loadAll(). */
  skippedRecords = 0;

  constructor(private readonly db: IDBDatabase) {}

  async loadAll(): Promise<Snapshot> {
    const tx = this.db.transaction([STORES.sources, STORES.channels, STORES.playlists], 'readonly');
    const [sources, channels, playlists] = await Promise.all([
      req(tx.objectStore(STORES.sources).getAll()),
      req(tx.objectStore(STORES.channels).getAll()),
      req(tx.objectStore(STORES.playlists).getAll()),
    ]);
    const s = (sources as unknown[]).filter(validSource);
    const c = (channels as unknown[]).filter(validChannel);
    const p = (playlists as unknown[]).filter(validPlaylist).map((pl) => ({
      ...pl,
      channelIds: Array.from(new Set(pl.channelIds.filter((id): id is string => typeof id === 'string'))),
    }));
    this.skippedRecords = sources.length + channels.length + playlists.length - s.length - c.length - p.length;
    c.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    return { sources: s, channels: c, playlists: p };
  }

  async commitCatalogue({ source, channels, deleteChannelIds, playlist }: CatalogueCommit): Promise<void> {
    const tx = this.db.transaction([STORES.sources, STORES.channels, STORES.playlists], 'readwrite');
    const store = tx.objectStore(STORES.channels);
    const ops: (() => IDBRequest)[] = [];
    for (const id of deleteChannelIds) ops.push(() => store.delete(id));
    for (const c of channels) ops.push(() => store.put(c));
    ops.push(() => tx.objectStore(STORES.sources).put(source));
    ops.push(() => tx.objectStore(STORES.playlists).put(playlist));
    await writeBatched(tx, ops);
  }

  async savePlaylist(playlist: PersonalPlaylist): Promise<void> {
    const tx = this.db.transaction(STORES.playlists, 'readwrite');
    await writeAll(tx, () => tx.objectStore(STORES.playlists).put(playlist));
  }

  async saveSource(source: Source): Promise<void> {
    const tx = this.db.transaction(STORES.sources, 'readwrite');
    await writeAll(tx, () => tx.objectStore(STORES.sources).put(source));
  }

  async replaceAll(snapshot: Snapshot): Promise<void> {
    const tx = this.db.transaction([STORES.sources, STORES.channels, STORES.playlists], 'readwrite');
    const sources = tx.objectStore(STORES.sources);
    const channels = tx.objectStore(STORES.channels);
    const playlists = tx.objectStore(STORES.playlists);
    const ops: (() => IDBRequest)[] = [() => sources.clear(), () => channels.clear(), () => playlists.clear()];
    snapshot.sources.forEach((s) => ops.push(() => sources.put(s)));
    snapshot.channels.forEach((c) => ops.push(() => channels.put(c)));
    snapshot.playlists.forEach((p) => ops.push(() => playlists.put(p)));
    await writeBatched(tx, ops);
  }

  async clearAll(): Promise<void> {
    await this.replaceAll({ sources: [], channels: [], playlists: [] });
  }
}

export type OpenedRepository = { repo: Repository; warning?: string };

/** Opens IndexedDB, falling back to session-only memory storage with a visible warning. */
export async function openRepository(): Promise<OpenedRepository> {
  try {
    if (typeof indexedDB === 'undefined') throw new StorageError('IndexedDB is not available in this browser');
    const db = await openDatabase();
    return { repo: new IndexedDbRepository(db) };
  } catch (err) {
    const reason = err instanceof Error ? err.message : 'unknown error';
    return {
      repo: new MemoryRepository(),
      warning: `Browser storage is unavailable (${reason}). Changes will be lost when the page is closed.`,
    };
  }
}
