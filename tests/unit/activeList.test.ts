import { describe, expect, it } from 'vitest';
import { moveItem, neighbourAfterRemoval, stepInList } from '../../src/lib/navigation/activeList';
import { pickNeighbour } from '../../src/lib/navigation/focus';

describe('stepInList', () => {
  const ids = ['a', 'b', 'c'];
  it('moves forward and backward', () => {
    expect(stepInList(ids, 'a', 0, 1)).toBe('b');
    expect(stepInList(ids, 'b', 1, -1)).toBe('a');
  });
  it('wraps around at both ends', () => {
    expect(stepInList(ids, 'c', 2, 1)).toBe('a');
    expect(stepInList(ids, 'a', 0, -1)).toBe('c');
  });
  it('skips unplayable entries', () => {
    expect(stepInList(ids, 'a', 0, 1, (id) => id !== 'b')).toBe('c');
  });
  it('uses the former position when the current channel was removed', () => {
    // 'b' was at index 1 and has been removed: next is the entry now at index 1.
    expect(stepInList(['a', 'c'], 'b', 1, 1)).toBe('c');
    expect(stepInList(['a', 'c'], 'b', 1, -1)).toBe('a');
    expect(stepInList(['a', 'c'], 'x', 2, 1)).toBe('a'); // removed last item wraps
  });
  it('returns undefined when nothing else is playable', () => {
    expect(stepInList(['a'], 'a', 0, 1)).toBeUndefined();
    expect(stepInList([], undefined, 0, 1)).toBeUndefined();
  });
});

describe('list editing helpers', () => {
  it('moves items', () => {
    expect(moveItem(['a', 'b', 'c'], 0, 1)).toEqual(['b', 'a', 'c']);
    expect(moveItem(['a', 'b', 'c'], 2, 1)).toEqual(['a', 'c', 'b']);
    expect(moveItem(['a', 'b'], 0, -1)).toEqual(['a', 'b']);
  });
  it('picks a predictable neighbour after removal', () => {
    expect(neighbourAfterRemoval(1, 2)).toBe(1);
    expect(neighbourAfterRemoval(2, 2)).toBe(1);
    expect(neighbourAfterRemoval(0, 0)).toBe(-1);
  });
});

describe('pickNeighbour (spatial navigation)', () => {
  const box = (left: number, top: number, w = 100, h = 40) => ({ left, top, right: left + w, bottom: top + h });
  const from = box(100, 100);
  it('prefers the aligned element in the requested direction', () => {
    const candidates = [box(100, 160), box(300, 150), box(100, 40)];
    expect(pickNeighbour(from, candidates, 'down')).toBe(0);
    expect(pickNeighbour(from, candidates, 'up')).toBe(2);
    expect(pickNeighbour(from, candidates, 'right')).toBe(1);
  });
  it('returns -1 when nothing lies in that direction', () => {
    expect(pickNeighbour(from, [box(300, 100)], 'left')).toBe(-1);
  });
  it('breaks ties by order (deterministic)', () => {
    expect(pickNeighbour(from, [box(250, 100), box(250, 100)], 'right')).toBe(0);
  });
});
