import { describe, it, expect } from 'vitest';
import {
  bucketByTime,
  groupByHash,
  pickKeeper,
  toDuplicateGroup,
  defaultTrashKeys,
  pruneGroups,
  similarity,
  BUCKET_WINDOW_MS,
  type HashedItem,
} from '../src/cleanup/duplicates';
import { mergeMediaInfo } from '../src/cleanup/scan';
import { makeItem } from './fixtures';

const MIN = 60_000;
const T0 = 1_700_000_000_000;

function hashed(key: string, hash: bigint, extra: Partial<HashedItem> = {}): HashedItem {
  return { ...makeItem({ mediaKey: key, timestamp: T0 }), hash, ...extra };
}

describe('bucketByTime', () => {
  it('chains photos taken within the window and drops singletons', () => {
    const items = [
      makeItem({ mediaKey: 'a', timestamp: T0 }),
      makeItem({ mediaKey: 'b', timestamp: T0 + 2 * MIN }),
      makeItem({ mediaKey: 'c', timestamp: T0 + 11 * MIN }), // within 10 min of b
      makeItem({ mediaKey: 'lonely', timestamp: T0 + 60 * MIN }),
      makeItem({ mediaKey: 'd', timestamp: T0 + 200 * MIN }),
      makeItem({ mediaKey: 'e', timestamp: T0 + 200 * MIN + 1000 }),
    ];
    const buckets = bucketByTime(items).map((b) => b.map((i) => i.mediaKey));
    expect(buckets).toEqual([['a', 'b', 'c'], ['d', 'e']]);
  });
  it('sorts unsorted input', () => {
    const items = [makeItem({ mediaKey: 'late', timestamp: T0 + MIN }), makeItem({ mediaKey: 'early', timestamp: T0 })];
    expect(bucketByTime(items)[0].map((i) => i.mediaKey)).toEqual(['early', 'late']);
  });
  it('splits at exactly window + 1ms', () => {
    const items = [makeItem({ timestamp: T0 }), makeItem({ timestamp: T0 + BUCKET_WINDOW_MS + 1 })];
    expect(bucketByTime(items)).toEqual([]);
  });
  it('caps bucket size', () => {
    const items = Array.from({ length: 10 }, (_, i) => makeItem({ timestamp: T0 + i }));
    const buckets = bucketByTime(items, BUCKET_WINDOW_MS, 4);
    expect(buckets.map((b) => b.length)).toEqual([4, 4, 2]);
  });
});

describe('similarity / groupByHash', () => {
  it('scores identical hashes as 1 and fully different as 0', () => {
    expect(similarity(0n, 0n)).toBe(1);
    expect(similarity(0n, (1n << 64n) - 1n)).toBe(0);
  });
  it('groups look-alikes at the 0.90 threshold (6 of 64 bits)', () => {
    const base = 0b1010101010101010n;
    const close = base ^ 0b111111n; // 6 bits off -> 0.906
    const far = base ^ 0b1111111n; // 7 bits off -> 0.89
    const groups = groupByHash([hashed('a', base), hashed('b', close), hashed('c', far)]);
    expect(groups.map((g) => g.map((i) => i.mediaKey))).toEqual([['a', 'b']]);
  });
  it('drops single-item groups', () => {
    expect(groupByHash([hashed('a', 0n), hashed('b', (1n << 64n) - 1n)])).toEqual([]);
  });
});

describe('pickKeeper', () => {
  it('prefers higher resolution, then larger file, then earliest', () => {
    const lowRes = makeItem({ mediaKey: 'low', resWidth: 100, resHeight: 100, size: 9999, timestamp: T0 });
    const hiRes = makeItem({ mediaKey: 'hi', resWidth: 4000, resHeight: 3000, size: 10, timestamp: T0 + 1 });
    expect(pickKeeper([lowRes, hiRes]).mediaKey).toBe('hi');
    const small = makeItem({ mediaKey: 'small', resWidth: 10, resHeight: 10, size: 1, timestamp: T0 });
    const big = makeItem({ mediaKey: 'big', resWidth: 10, resHeight: 10, size: 2, timestamp: T0 + 1 });
    expect(pickKeeper([small, big]).mediaKey).toBe('big');
    const first = makeItem({ mediaKey: 'first', timestamp: T0 });
    const second = makeItem({ mediaKey: 'second', timestamp: T0 + 1 });
    expect(pickKeeper([second, first]).mediaKey).toBe('first');
  });
});

describe('groups, default picks and pruning', () => {
  const g1 = toDuplicateGroup([
    makeItem({ mediaKey: 'k1', resWidth: 4000, resHeight: 3000, timestamp: T0 }),
    makeItem({ mediaKey: 'x1', resWidth: 1000, resHeight: 750, timestamp: T0 + 1 }),
    makeItem({ mediaKey: 'x2', resWidth: 1000, resHeight: 750, timestamp: T0 + 2 }),
  ]);
  const g2 = toDuplicateGroup([
    makeItem({ mediaKey: 'y1', size: 1, timestamp: T0 }),
    makeItem({ mediaKey: 'k2', size: 5, timestamp: T0 + 1 }),
  ]);

  it('pre-marks every item except the keeper', () => {
    expect(g1.keepKey).toBe('k1');
    expect(g2.keepKey).toBe('k2');
    expect([...defaultTrashKeys([g1, g2])].sort()).toEqual(['x1', 'x2', 'y1']);
  });
  it('the keeper is never in the default trash set', () => {
    const keys = defaultTrashKeys([g1, g2]);
    expect(keys.has('k1')).toBe(false);
    expect(keys.has('k2')).toBe(false);
  });
  it('prunes trashed items and drops groups left with one photo', () => {
    const pruned = pruneGroups([g1, g2], new Set(['x1', 'y1']));
    expect(pruned).toHaveLength(1);
    expect(pruned[0].items.map((i) => i.mediaKey)).toEqual(['k1', 'x2']);
    expect(pruned[0].keepKey).toBe('k1');
  });
  it('re-picks a keeper if the old keeper was removed', () => {
    const pruned = pruneGroups([g1], new Set(['k1']));
    expect(pruned[0].items.map((i) => i.mediaKey)).toEqual(['x1', 'x2']);
    expect(['x1', 'x2']).toContain(pruned[0].keepKey);
  });
});

describe('mergeMediaInfo', () => {
  it('merges batch info by mediaKey without clobbering with undefined', () => {
    const items = [makeItem({ mediaKey: 'a', isOwned: true, fileName: 'keep.jpg' }), makeItem({ mediaKey: 'b' })];
    const merged = mergeMediaInfo(items, [{ mediaKey: 'a', size: 42, takesUpSpace: true, fileName: undefined }]);
    expect(merged[0]).toMatchObject({ mediaKey: 'a', size: 42, takesUpSpace: true, isOwned: true, fileName: 'keep.jpg' });
    expect(merged[1].size).toBeUndefined();
  });
});
