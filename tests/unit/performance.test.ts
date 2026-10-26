import { describe, expect, it } from 'vitest';
import { M3UParser, parseM3U } from '../../src/lib/m3u/parser';
import { reconcile } from '../../src/lib/reconciliation/reconcile';
import { filterChannels } from '../../src/features/catalogue/filter';
// @ts-expect-error plain JS helper shared with the fixture script
import { syntheticCatalogue } from '../../scripts/generate-fixture.mjs';

/**
 * Desktop-node timings for the 10,000-entry synthetic fixture. These are
 * regression guards, not TV measurements; TV figures go in IMPLEMENTATION_STATUS.md.
 */
describe('10,000-channel synthetic catalogue', () => {
  const text: string = syntheticCatalogue(10000);
  const textNewToken: string = syntheticCatalogue(10000, { token: 'tok2' });

  it('parses all entries; every chunk stays small', () => {
    const parser = new M3UParser(text);
    let worst = 0;
    let done = false;
    while (!done) {
      const t = performance.now();
      done = parser.step(500);
      worst = Math.max(worst, performance.now() - t);
    }
    const r = parser.result();
    expect(r.entries).toHaveLength(10000);
    expect(r.entries[7].name).toBe('Synthetic Channel 7, Extra');
    expect(r.warningCounts['provider-directives']).toBe(200);
    console.info(`[perf] worst 500-line parse slice: ${worst.toFixed(1)} ms`);
    expect(worst).toBeLessThan(50);
  });

  it('reconciles a token change keeping every saved channel', () => {
    let n = 0;
    const gen = () => `id${++n}`;
    const first = reconcile([], parseM3U(text).entries, new Set(), 's', gen);
    const saved = new Set(first.channels.filter((_, i) => i % 100 === 0).map((c) => c.id));
    const t = performance.now();
    const second = reconcile(first.channels, parseM3U(textNewToken).entries, saved, 's', gen);
    const ms = performance.now() - t;
    console.info(`[perf] reconcile 10k: ${ms.toFixed(0)} ms`);
    expect(second.stats.added).toBe(0);
    expect(second.stats.missing + second.stats.ambiguous).toBe(0);
    const ids = new Set(second.channels.map((c) => c.id));
    for (const id of saved) expect(ids.has(id)).toBe(true);
    expect(second.channels.every((c) => c.streamUrl.includes('tok2'))).toBe(true);
  });

  it('searches quickly', () => {
    const channels = reconcile([], parseM3U(text).entries, new Set(), 's', () => Math.random().toString(36)).channels;
    const t = performance.now();
    for (let i = 0; i < 20; i++) filterChannels(channels, `channel ${i}`, i % 2 ? 'News' : '');
    const per = (performance.now() - t) / 20;
    console.info(`[perf] search over 10k: ${per.toFixed(2)} ms per query`);
    expect(per).toBeLessThan(30);
  });
});
