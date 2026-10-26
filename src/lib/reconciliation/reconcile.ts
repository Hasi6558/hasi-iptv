import type { Channel } from '../types';
import type { ParsedEntry } from '../m3u/parser';
import { identityName, normalizeName } from '../m3u/normalize';

export type ReconcileStats = {
  added: number;
  updated: number;
  unchanged: number;
  /** Saved channels with no candidate in the new catalogue. */
  missing: number;
  /** Saved channels with several plausible candidates; kept for review, never auto-substituted. */
  ambiguous: number;
  /** Unsaved channels no longer in the catalogue (dropped). */
  removed: number;
  /** Saved channels that were missing/needs-review before and are matched again. */
  restored: number;
};

export type ReconcileResult = {
  channels: Channel[];
  deletedIds: string[];
  stats: ReconcileStats;
  /** Set when the refresh looks suspicious and should be confirmed before committing. */
  suspicious?: string;
};

type KeyFn = (c: { providerId?: string; name: string; group?: string; streamUrl: string }) => string | undefined;

/**
 * Matching passes from most to least reliable. A pass only matches keys that
 * are unique on BOTH sides among still-unmatched entries, so duplicated
 * identifiers never merge different channels.
 */
const PASSES: { name: string; key: KeyFn }[] = [
  { name: 'provider-id', key: (c) => c.providerId || undefined },
  { name: 'provider-id+name', key: (c) => (c.providerId ? `${c.providerId}\u0000${identityName(c.name)}` : undefined) },
  { name: 'stream-url', key: (c) => c.streamUrl || undefined },
  { name: 'name+group', key: (c) => `${identityName(c.name)}\u0000${(c.group ?? '').toLowerCase()}` },
  { name: 'name', key: (c) => identityName(c.name) || undefined },
];

function countKeys<T>(items: T[], key: (t: T) => string | undefined): Map<string, number> {
  const counts = new Map<string, number>();
  for (const it of items) {
    const k = key(it);
    if (k !== undefined) counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return counts;
}

function sameContent(a: Channel, b: Channel): boolean {
  return (
    a.name === b.name &&
    a.group === b.group &&
    a.logoUrl === b.logoUrl &&
    a.streamUrl === b.streamUrl &&
    a.providerId === b.providerId &&
    a.availability === b.availability &&
    (a.directives ?? []).join() === (b.directives ?? []).join() &&
    a.order === b.order
  );
}

export function reconcile(
  existing: Channel[],
  incoming: ParsedEntry[],
  savedIds: ReadonlySet<string>,
  sourceId: string,
  newId: () => string,
): ReconcileResult {
  const stats: ReconcileStats = { added: 0, updated: 0, unchanged: 0, missing: 0, ambiguous: 0, removed: 0, restored: 0 };
  const matchOf = new Map<number, Channel>(); // incoming index -> existing channel
  let unmatchedExisting = existing.slice();
  let unmatchedIncoming = incoming.map((e, i) => ({ e, i }));
  const ambiguousIds = new Set<string>();

  for (const pass of PASSES) {
    if (!unmatchedExisting.length || !unmatchedIncoming.length) break;
    const exCounts = countKeys(unmatchedExisting, pass.key);
    const inCounts = countKeys(unmatchedIncoming, (x) => pass.key(x.e));
    const exByKey = new Map<string, Channel>();
    for (const c of unmatchedExisting) {
      const k = pass.key(c);
      if (k !== undefined && exCounts.get(k) === 1 && inCounts.get(k) === 1) exByKey.set(k, c);
      else if (k !== undefined && inCounts.has(k) && (exCounts.get(k)! > 1 || inCounts.get(k)! > 1)) {
        ambiguousIds.add(c.id);
      }
    }
    if (!exByKey.size) continue;
    const matchedExisting = new Set<string>();
    unmatchedIncoming = unmatchedIncoming.filter(({ e, i }) => {
      const k = pass.key(e);
      const c = k !== undefined ? exByKey.get(k) : undefined;
      if (!c) return true;
      matchOf.set(i, c);
      matchedExisting.add(c.id);
      return false;
    });
    unmatchedExisting = unmatchedExisting.filter((c) => !matchedExisting.has(c.id));
  }

  const channels: Channel[] = incoming.map((e, i) => {
    const prev = matchOf.get(i);
    const next: Channel = {
      id: prev ? prev.id : newId(),
      sourceId,
      name: e.name,
      normalizedName: normalizeName(e.name),
      streamUrl: e.streamUrl,
      availability: 'available',
      order: i,
    };
    if (e.providerId) next.providerId = e.providerId;
    if (e.group) next.group = e.group;
    if (e.logoUrl) next.logoUrl = e.logoUrl;
    if (e.directives?.length) next.directives = e.directives;
    if (!prev) stats.added++;
    else {
      if (prev.availability !== 'available' && savedIds.has(prev.id)) stats.restored++;
      if (sameContent(prev, next)) stats.unchanged++;
      else stats.updated++;
    }
    return next;
  });

  const deletedIds: string[] = [];
  let order = incoming.length;
  for (const c of unmatchedExisting) {
    if (!savedIds.has(c.id)) {
      deletedIds.push(c.id);
      stats.removed++;
      continue;
    }
    // Keep saved entries visible with their last-known details.
    const availability = ambiguousIds.has(c.id) ? 'needs-review' : 'missing';
    if (availability === 'needs-review') stats.ambiguous++;
    else stats.missing++;
    channels.push({ ...c, sourceId, availability, order: order++ });
  }

  const result: ReconcileResult = { channels, deletedIds, stats };
  const previouslyAvailable = existing.filter((c) => c.availability === 'available').length;
  if (previouslyAvailable >= 50 && incoming.length < previouslyAvailable * 0.2) {
    result.suspicious = `The new playlist has ${incoming.length} channels, down from ${previouslyAvailable}. It may be incomplete or an error page.`;
  }
  return result;
}
