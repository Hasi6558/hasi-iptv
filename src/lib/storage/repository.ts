import type { Channel, PersonalPlaylist, Source } from '../types';

export type Snapshot = {
  sources: Source[];
  channels: Channel[];
  playlists: PersonalPlaylist[];
};

export type CatalogueCommit = {
  source: Source;
  /** Channels to insert or overwrite. */
  channels: Channel[];
  deleteChannelIds: string[];
  playlist: PersonalPlaylist;
};

/** Small storage interface so IndexedDB and the in-memory fallback are interchangeable. */
export interface Repository {
  readonly persistent: boolean;
  loadAll(): Promise<Snapshot>;
  /** Atomically writes a refreshed catalogue and the playlist that references it. */
  commitCatalogue(commit: CatalogueCommit): Promise<void>;
  savePlaylist(playlist: PersonalPlaylist): Promise<void>;
  saveSource(source: Source): Promise<void>;
  /** Replaces everything (full-backup restore). */
  replaceAll(snapshot: Snapshot): Promise<void>;
  clearAll(): Promise<void>;
}

export class StorageError extends Error {
  constructor(
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'StorageError';
  }
}

export function describeStorageError(err: unknown): string {
  const name = (err as { name?: string } | null)?.name;
  if (name === 'QuotaExceededError') return 'Browser storage is full. Free space or clear data, then try again.';
  if (name === 'InvalidStateError' || name === 'SecurityError') return 'Browser storage is blocked (private mode or site-data settings).';
  if (err instanceof StorageError) return err.message;
  return 'Saving to browser storage failed.';
}

export class MemoryRepository implements Repository {
  readonly persistent = false;
  private data: Snapshot = { sources: [], channels: [], playlists: [] };

  async loadAll(): Promise<Snapshot> {
    return structuredCloneSafe(this.data);
  }

  async commitCatalogue({ source, channels, deleteChannelIds, playlist }: CatalogueCommit): Promise<void> {
    const del = new Set(deleteChannelIds);
    const byId = new Map(this.data.channels.filter((c) => !del.has(c.id)).map((c) => [c.id, c]));
    for (const c of channels) byId.set(c.id, c);
    this.data.channels = Array.from(byId.values());
    this.data.sources = [...this.data.sources.filter((s) => s.id !== source.id), source];
    await this.savePlaylist(playlist);
  }

  async savePlaylist(playlist: PersonalPlaylist): Promise<void> {
    this.data.playlists = [...this.data.playlists.filter((p) => p.id !== playlist.id), { ...playlist, channelIds: playlist.channelIds.slice() }];
  }

  async saveSource(source: Source): Promise<void> {
    this.data.sources = [...this.data.sources.filter((s) => s.id !== source.id), source];
  }

  async replaceAll(snapshot: Snapshot): Promise<void> {
    this.data = structuredCloneSafe(snapshot);
  }

  async clearAll(): Promise<void> {
    this.data = { sources: [], channels: [], playlists: [] };
  }
}

function structuredCloneSafe<T>(v: T): T {
  return typeof structuredClone === 'function' ? structuredClone(v) : JSON.parse(JSON.stringify(v));
}
