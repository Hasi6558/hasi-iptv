/**
 * Previous/next channel within the active list, wrapping at both ends.
 *
 * If the current channel has been removed from the list, `lastIndex` (its
 * former position) is used: "next" becomes the entry that now occupies that
 * position and "previous" the one before it. Entries rejected by `playable`
 * are skipped. Returns undefined when nothing else is playable.
 */
export function stepInList(
  ids: readonly string[],
  currentId: string | undefined,
  lastIndex: number,
  dir: 1 | -1,
  playable: (id: string) => boolean = () => true,
): string | undefined {
  const n = ids.length;
  if (!n) return undefined;
  const at = currentId ? ids.indexOf(currentId) : -1;
  let start: number;
  if (at >= 0) start = at + dir;
  else {
    const base = Math.min(Math.max(lastIndex, 0), n);
    start = dir === 1 ? base : base - 1;
  }
  for (let k = 0; k < n; k++) {
    const i = (((start + dir * k) % n) + n) % n;
    if (ids[i] !== currentId && playable(ids[i])) return ids[i];
  }
  return undefined;
}

/** Index to keep the focus on after `removedIndex` disappears from a list of new length `length`. */
export function neighbourAfterRemoval(removedIndex: number, length: number): number {
  if (length <= 0) return -1;
  return Math.min(removedIndex, length - 1);
}

export function moveItem<T>(list: readonly T[], from: number, to: number): T[] {
  if (from < 0 || from >= list.length || to < 0 || to >= list.length || from === to) return list.slice();
  const out = list.slice();
  const [it] = out.splice(from, 1);
  out.splice(to, 0, it);
  return out;
}
