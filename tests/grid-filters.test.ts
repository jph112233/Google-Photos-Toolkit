import { describe, it, expect } from 'vitest';
import { ALL, applyFilters, BIG_VIDEO_SIZES, is4K, isUseful, lengthFilter, optionCounts, sizeFilter, typeFilter, whenFilter } from '../src/cleanup/grid-filters';
import type { MediaItem } from '../src/types';

const MB = 1024 * 1024;
const DAY = 86_400_000;
const NOW = Date.UTC(2026, 10, 10, 12);

function item(over: Partial<MediaItem>): MediaItem {
  return { mediaKey: Math.random().toString(36), timestamp: NOW, creationTimestamp: NOW, dedupKey: 'd', ...over };
}

const pick = (i: MediaItem): MediaItem => i;

describe('whenFilter', () => {
  const items = [
    item({ mediaKey: 'new', timestamp: NOW - 10 * DAY }),
    item({ mediaKey: 'mid', timestamp: NOW - 400 * DAY }),
    item({ mediaKey: 'old', timestamp: NOW - 2000 * DAY }),
    item({ mediaKey: 'nodate', timestamp: 0 }),
  ];
  const f = whenFilter(items, NOW);

  it('lists relative ages then years present, newest year first', () => {
    const values = f.options.map((o) => o.value);
    expect(values.slice(0, 4)).toEqual([ALL, 'older-6m', 'older-1y', 'older-3y']);
    const years = values.slice(4);
    expect(years).toEqual([...years].sort().reverse());
    expect(years).toHaveLength(3);
  });

  it('older-than options are cumulative and skip undated items', () => {
    const c = optionCounts(items, f);
    expect(c.get('older-6m')).toBe(2);
    expect(c.get('older-1y')).toBe(2);
    expect(c.get('older-3y')).toBe(1);
    expect(c.get(ALL)).toBe(4);
  });
});

describe('size, length, type', () => {
  it('buckets big videos by size without overlap', () => {
    const f = sizeFilter(BIG_VIDEO_SIZES);
    const items = [60, 100, 499, 500, 1024, 3000].map((m) => item({ size: m * MB }));
    const c = optionCounts(items, f);
    expect([c.get('50-100mb'), c.get('100-500mb'), c.get('500mb-1gb'), c.get('1gb')]).toEqual([1, 2, 1, 2]);
  });

  it('buckets by length', () => {
    const f = lengthFilter();
    const items = [10, 30, 119, 120, 600, 3600].map((s) => item({ duration: s * 1000 }));
    const c = optionCounts(items, f);
    expect([c.get('lt30s'), c.get('30s-2m'), c.get('2-10m'), c.get('gt10m')]).toEqual([1, 2, 1, 2]);
  });

  it('splits photos and videos', () => {
    const c = optionCounts([item({}), item({ duration: 5000 })], typeFilter());
    expect([c.get('photos'), c.get('videos')]).toEqual([1, 1]);
  });

  it('detects 4K in either orientation', () => {
    expect(is4K(item({ resWidth: 3840, resHeight: 2160 }))).toBe(true);
    expect(is4K(item({ resWidth: 2160, resHeight: 3840 }))).toBe(true);
    expect(is4K(item({ resWidth: 1920, resHeight: 1080 }))).toBe(false);
    expect(is4K(item({}))).toBe(false);
  });
});

describe('isUseful', () => {
  it('hides a filter that cannot narrow the list', () => {
    const allPhotos = [item({}), item({})];
    expect(isUseful(allPhotos, typeFilter())).toBe(false);
    expect(isUseful([item({}), item({ duration: 1000 })], typeFilter())).toBe(true);
    expect(isUseful([], typeFilter())).toBe(false);
  });
});

describe('applyFilters', () => {
  const items = [
    item({ mediaKey: 'a', size: 60 * MB, duration: 10_000 }),
    item({ mediaKey: 'b', size: 2000 * MB, duration: 10_000 }),
    item({ mediaKey: 'c', size: 2000 * MB, duration: 900_000 }),
  ];
  const filters = [sizeFilter(BIG_VIDEO_SIZES), lengthFilter()];

  it('ANDs chosen options', () => {
    const out = applyFilters(items, filters, { size: '1gb', length: 'lt30s' }, pick);
    expect(out.map((i) => i.mediaKey)).toEqual(['b']);
  });

  it('treats all, missing and unknown values as any', () => {
    expect(applyFilters(items, filters, {}, pick)).toHaveLength(3);
    expect(applyFilters(items, filters, { size: ALL, length: 'nope' }, pick)).toHaveLength(3);
  });

  it('works on wrapped values via pick', () => {
    const groups = items.map((i) => ({ items: [i] }));
    expect(applyFilters(groups, filters, { length: 'gt10m' }, (g) => g.items[0])).toHaveLength(1);
  });
});
