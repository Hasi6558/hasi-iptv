import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it } from 'vitest';
import { IndexedDbRepository, openDatabase, DB_VERSION } from '../../src/lib/storage/indexedDb';
import { MemoryRepository } from '../../src/lib/storage/repository';
import {
  BackupError,
  createFullBackup,
  createPersonalBackup,
  parseBackup,
  planPersonalRestore,
} from '../../src/lib/storage/backup';
import { DEFAULT_PREFS, sanitizePrefs } from '../../src/lib/storage/prefs';
import type { Channel, PersonalPlaylist, Source } from '../../src/lib/types';

const source: Source = { id: 's1', name: 'Test', kind: 'url', url: 'https://p.example/list.m3u?token=SECRET' };
const ch = (id: string, name: string, extra: Partial<Channel> = {}): Channel => ({
  id,
  sourceId: 's1',
  name,
  normalizedName: name.toLowerCase(),
  streamUrl: `https://s.example/SECRET/${id}`,
  availability: 'available',
  order: 0,
  ...extra,
});
const playlist = (ids: string[]): PersonalPlaylist => ({ id: 'my-channels', name: 'My Channels', channelIds: ids });

describe('IndexedDbRepository', () => {
  let factory: IDBFactory;
  beforeEach(() => {
    factory = new IDBFactory();
  });

  it('creates the schema and survives reopen (reload)', async () => {
    const db = await openDatabase(factory);
    expect(db.version).toBe(DB_VERSION);
    const repo = new IndexedDbRepository(db);
    await repo.commitCatalogue({ source, channels: [ch('a', 'A', { order: 1 }), ch('b', 'B', { order: 0 })], deleteChannelIds: [], playlist: playlist(['a']) });
    db.close();
    const repo2 = new IndexedDbRepository(await openDatabase(factory));
    const snap = await repo2.loadAll();
    expect(snap.sources).toEqual([source]);
    expect(snap.channels.map((c) => c.id)).toEqual(['b', 'a']); // sorted by catalogue order
    expect(snap.playlists[0].channelIds).toEqual(['a']);
  });

  it('applies deletes and puts in one transaction', async () => {
    const repo = new IndexedDbRepository(await openDatabase(factory));
    await repo.commitCatalogue({ source, channels: [ch('a', 'A'), ch('b', 'B')], deleteChannelIds: [], playlist: playlist([]) });
    await repo.commitCatalogue({ source, channels: [ch('c', 'C')], deleteChannelIds: ['a'], playlist: playlist(['c']) });
    const snap = await repo.loadAll();
    expect(snap.channels.map((c) => c.id).sort()).toEqual(['b', 'c']);
  });

  it('a failed commit leaves the previous data intact', async () => {
    const repo = new IndexedDbRepository(await openDatabase(factory));
    await repo.commitCatalogue({ source, channels: [ch('a', 'A')], deleteChannelIds: [], playlist: playlist(['a']) });
    // A channel without its key path makes put() throw inside the transaction.
    const bad = { ...ch('x', 'X'), id: undefined } as unknown as Channel;
    await expect(repo.commitCatalogue({ source, channels: [ch('b', 'B'), bad], deleteChannelIds: ['a'], playlist: playlist(['b']) })).rejects.toBeTruthy();
    const snap = await repo.loadAll();
    expect(snap.channels.map((c) => c.id)).toEqual(['a']);
    expect(snap.playlists[0].channelIds).toEqual(['a']);
  });

  it('skips corrupt records and de-duplicates playlist references', async () => {
    const db = await openDatabase(factory);
    const tx = db.transaction(['channels', 'playlists'], 'readwrite');
    tx.objectStore('channels').put({ id: 'broken' });
    tx.objectStore('channels').put(ch('ok', 'OK'));
    tx.objectStore('playlists').put({ id: 'my-channels', name: 'x', channelIds: ['ok', 'ok', 5] });
    await new Promise((r) => (tx.oncomplete = r));
    const repo = new IndexedDbRepository(db);
    const snap = await repo.loadAll();
    expect(snap.channels.map((c) => c.id)).toEqual(['ok']);
    expect(snap.playlists[0].channelIds).toEqual(['ok']);
    expect(repo.skippedRecords).toBe(1);
  });

  it('clearAll removes everything', async () => {
    const repo = new IndexedDbRepository(await openDatabase(factory));
    await repo.commitCatalogue({ source, channels: [ch('a', 'A')], deleteChannelIds: [], playlist: playlist(['a']) });
    await repo.clearAll();
    expect(await repo.loadAll()).toEqual({ sources: [], channels: [], playlists: [] });
  });
});

describe('MemoryRepository fallback', () => {
  it('behaves like the persistent repository within a session', async () => {
    const repo = new MemoryRepository();
    await repo.commitCatalogue({ source, channels: [ch('a', 'A'), ch('b', 'B')], deleteChannelIds: [], playlist: playlist(['b']) });
    await repo.commitCatalogue({ source, channels: [], deleteChannelIds: ['a'], playlist: playlist(['b']) });
    const snap = await repo.loadAll();
    expect(snap.channels.map((c) => c.id)).toEqual(['b']);
    expect(repo.persistent).toBe(false);
  });
});

describe('backups', () => {
  const channels = [ch('a', 'Alpha', { providerId: 'alpha.xx', group: 'News' }), ch('b', 'Beta'), ch('c', 'Gamma')];
  const map = new Map(channels.map((c) => [c.id, c]));

  it('personal backup contains no URLs or tokens', () => {
    const b = createPersonalBackup(playlist(['c', 'a']), map, DEFAULT_PREFS);
    const json = JSON.stringify(b);
    expect(json).not.toContain('SECRET');
    expect(json).not.toContain('http');
    expect(b.playlist.entries.map((e) => e.name)).toEqual(['Gamma', 'Alpha']);
  });

  it('personal round trip preserves order and matches against a new catalogue', () => {
    const backup = parseBackup(JSON.stringify(createPersonalBackup(playlist(['c', 'a', 'b']), map, DEFAULT_PREFS)));
    if (backup.kind !== 'personal') throw new Error('kind');
    // New catalogue with different internal IDs and tokens; "Beta" is gone.
    const fresh = [ch('x1', 'Alpha', { providerId: 'alpha.xx', group: 'News' }), ch('x3', 'Gamma')];
    let i = 0;
    const plan = planPersonalRestore(backup, fresh, 's1', () => `ph${++i}`);
    expect(plan.channelIds).toEqual(['x3', 'x1', 'ph1']);
    expect(plan.placeholders[0]).toMatchObject({ name: 'Beta', availability: 'missing', streamUrl: '' });
    expect(plan).toMatchObject({ matched: 2, unmatched: 1 });
  });

  it('does not guess when several catalogue entries match a backup entry', () => {
    const backup = parseBackup(JSON.stringify(createPersonalBackup(playlist(['b']), map, DEFAULT_PREFS)));
    if (backup.kind !== 'personal') throw new Error('kind');
    const plan = planPersonalRestore(backup, [ch('y1', 'Beta'), ch('y2', 'Beta')], 's1', () => 'ph');
    expect(plan.unmatched).toBe(1);
  });

  it('full backup round trip preserves data', () => {
    const snapshot = { sources: [source], channels, playlists: [playlist(['b', 'a'])] };
    const parsed = parseBackup(JSON.stringify(createFullBackup(snapshot, DEFAULT_PREFS)));
    if (parsed.kind !== 'full') throw new Error('kind');
    expect(parsed.data.sources[0].url).toBe(source.url);
    expect(parsed.data.channels.map((c) => c.streamUrl)).toEqual(channels.map((c) => c.streamUrl));
    expect(parsed.data.playlists[0].channelIds).toEqual(['b', 'a']);
  });

  it('rejects invalid or unsafe backups before applying anything', () => {
    expect(() => parseBackup('not json')).toThrow(BackupError);
    expect(() => parseBackup('{"format":"other"}')).toThrow(/not a Hasi IPTV backup/);
    expect(() => parseBackup(JSON.stringify({ format: 'hasi-iptv-backup', version: 99, kind: 'personal' }))).toThrow(/newer version/);
    const evil = createFullBackup({ sources: [source], channels: [ch('a', 'A', { streamUrl: 'javascript:alert(1)' })], playlists: [] }, DEFAULT_PREFS);
    expect(() => parseBackup(JSON.stringify(evil))).toThrow(/unsupported URL/);
  });

  it('drops dangling playlist references in a full backup', () => {
    const parsed = parseBackup(JSON.stringify(createFullBackup({ sources: [source], channels: [ch('a', 'A')], playlists: [playlist(['a', 'ghost', 'a'])] }, DEFAULT_PREFS)));
    if (parsed.kind !== 'full') throw new Error('kind');
    expect(parsed.data.playlists[0].channelIds).toEqual(['a']);
  });
});

describe('prefs', () => {
  it('sanitizes unexpected values', () => {
    const p = sanitizePrefs({ showLogos: 'yes' as unknown as boolean, engine: 'flash' as never, catalogue: { query: 5 as never, group: 'News', page: -3 } });
    expect(p.showLogos).toBe(true);
    expect(p.engine).toBe('auto');
    expect(p.catalogue).toEqual({ query: '', group: 'News', page: 0 });
  });
});

describe('batched writes', () => {
  it('commits more records than one batch atomically', async () => {
    const repo = new IndexedDbRepository(await openDatabase(new IDBFactory()));
    const many = Array.from({ length: 1500 }, (_, i) => ch(`m${i}`, `M${i}`, { order: i }));
    await repo.commitCatalogue({ source, channels: many, deleteChannelIds: [], playlist: playlist(['m0', 'm1499']) });
    const snap = await repo.loadAll();
    expect(snap.channels).toHaveLength(1500);
    // A failure in a late batch rolls back the earlier batches too.
    const bad = [...many.map((c) => ({ ...c, name: 'changed' })), { id: undefined } as unknown as Channel];
    await expect(repo.commitCatalogue({ source, channels: bad, deleteChannelIds: [], playlist: playlist([]) })).rejects.toBeTruthy();
    const after = await repo.loadAll();
    expect(after.channels.every((c) => c.name !== 'changed')).toBe(true);
    expect(after.playlists[0].channelIds).toEqual(['m0', 'm1499']);
  });
});
