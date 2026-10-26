import { describe, expect, it } from 'vitest';
import { reconcile } from '../../src/lib/reconciliation/reconcile';
import type { ParsedEntry } from '../../src/lib/m3u/parser';
import type { Channel } from '../../src/lib/types';

let n = 0;
const gen = () => `id${++n}`;
const entry = (name: string, url: string, extra: Partial<ParsedEntry> = {}): ParsedEntry => ({ name, streamUrl: url, line: 1, ...extra });

function first(entries: ParsedEntry[]) {
  return reconcile([], entries, new Set(), 'src', gen).channels;
}

describe('reconcile', () => {
  it('adds everything on first import', () => {
    const r = reconcile([], [entry('A', 'https://x/a'), entry('B', 'https://x/b')], new Set(), 'src', gen);
    expect(r.stats.added).toBe(2);
    expect(r.channels.every((c) => c.availability === 'available')).toBe(true);
  });

  it('keeps internal IDs when the URL token changes (matched by provider ID)', () => {
    const before = first([entry('A', 'https://x/tok1/a', { providerId: 'a' }), entry('B', 'https://x/tok1/b', { providerId: 'b' })]);
    const saved = new Set([before[1].id]);
    const r = reconcile(before, [entry('A', 'https://x/tok2/a', { providerId: 'a' }), entry('B', 'https://x/tok2/b', { providerId: 'b' })], saved, 'src', gen);
    expect(r.channels.map((c) => c.id)).toEqual(before.map((c) => c.id));
    expect(r.channels[1].streamUrl).toBe('https://x/tok2/b');
    expect(r.stats.updated).toBe(2);
  });

  it('matches by name+group when no provider IDs exist', () => {
    const before = first([entry('Alpha (720p)', 'https://x/1/a', { group: 'News' })]);
    const r = reconcile(before, [entry('Alpha (1080p)', 'https://x/2/a', { group: 'News' })], new Set([before[0].id]), 'src', gen);
    expect(r.channels[0].id).toBe(before[0].id);
    expect(r.channels[0].name).toBe('Alpha (1080p)');
  });

  it('does not merge channels that share a duplicated provider ID', () => {
    const before = first([entry('Same HD', 'https://x/1', { providerId: 'dup' }), entry('Same SD', 'https://x/2', { providerId: 'dup' })]);
    const r = reconcile(
      before,
      [entry('Same SD', 'https://y/2', { providerId: 'dup' }), entry('Same HD', 'https://y/1', { providerId: 'dup' })],
      new Set(before.map((c) => c.id)),
      'src',
      gen,
    );
    const hd = r.channels.find((c) => c.name === 'Same HD')!;
    const sd = r.channels.find((c) => c.name === 'Same SD')!;
    expect(hd.id).toBe(before[0].id);
    expect(sd.id).toBe(before[1].id);
    expect(new Set(r.channels.map((c) => c.id)).size).toBe(r.channels.length);
  });

  it('keeps missing saved channels and drops missing unsaved ones', () => {
    const before = first([entry('Keep', 'https://x/k', { providerId: 'k' }), entry('Drop', 'https://x/d', { providerId: 'd' }), entry('Stay', 'https://x/s', { providerId: 's' })]);
    const r = reconcile(before, [entry('Stay', 'https://x/s', { providerId: 's' })], new Set([before[0].id]), 'src', gen);
    const kept = r.channels.find((c) => c.id === before[0].id)!;
    expect(kept.availability).toBe('missing');
    expect(r.deletedIds).toEqual([before[1].id]);
    expect(r.stats).toMatchObject({ missing: 1, removed: 1 });
  });

  it('labels ambiguous matches for review instead of substituting', () => {
    const before = first([entry('News', 'https://x/old')]);
    const r = reconcile(before, [entry('News', 'https://x/new1'), entry('News', 'https://x/new2')], new Set([before[0].id]), 'src', gen);
    const saved = r.channels.find((c) => c.id === before[0].id)!;
    expect(saved.availability).toBe('needs-review');
    expect(saved.streamUrl).toBe('https://x/old');
    expect(r.stats.ambiguous).toBe(1);
    expect(r.stats.added).toBe(2);
  });

  it('restores placeholders when a matching source is imported later', () => {
    const placeholder: Channel = { id: 'ph1', sourceId: 'src', name: 'Alpha', normalizedName: 'alpha', providerId: 'a', streamUrl: '', availability: 'missing', order: 0 };
    const r = reconcile([placeholder], [entry('Alpha', 'https://x/a', { providerId: 'a' })], new Set(['ph1']), 'src', gen);
    expect(r.channels[0]).toMatchObject({ id: 'ph1', availability: 'available', streamUrl: 'https://x/a' });
    expect(r.stats.restored).toBe(1);
  });

  it('reports unchanged entries on an identical refresh', () => {
    const entries = [entry('A', 'https://x/a', { providerId: 'a' })];
    const before = first(entries);
    const r = reconcile(before, entries, new Set(), 'src', gen);
    expect(r.stats).toMatchObject({ unchanged: 1, updated: 0, added: 0 });
  });

  it('flags a suspiciously small refresh', () => {
    const before = first(Array.from({ length: 100 }, (_, i) => entry(`C${i}`, `https://x/${i}`)));
    const r = reconcile(before, [entry('C1', 'https://x/1')], new Set(), 'src', gen);
    expect(r.suspicious).toMatch(/1 channels, down from 100/);
  });
});
