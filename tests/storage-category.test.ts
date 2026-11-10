import { describe, it, expect, vi } from 'vitest';
import parser from '../src/api/parser';
import { readStorageCategory, unionItems, ScanStoppedError } from '../src/cleanup/scan';
import { StorageCategory } from '../src/types';
import type { StorageCategoryPage, MediaItem } from '../src/types';
import type Api from '../src/api/api';

// Synthetic omQMf payload with the shape observed live (no real user data).
function rawItem(key: string, bytes: number, opts: { quality?: number; video?: boolean; notOwned?: boolean; takesUpSpace?: number } = {}): unknown[] {
  const ext: Record<string, unknown> = { '15': 1, '318563170': [[opts.takesUpSpace ?? 1, bytes, opts.quality ?? 1, 0, null, 1]] };
  if (opts.video) ext['76647426'] = [42000];
  const flags = opts.notOwned ? [[1], [27]] : [[1], [2], [3]];
  return [key, [`https://example.test/${key}`, 4032, 3024], 1692235995204, `dedup-${key}`, -18000000, 1692279100379, null, flags, 2, ext];
}

describe('parser: omQMf (Manage storage lists)', () => {
  it('parses items with storage bytes, space, quality and next page token', () => {
    const data = [[rawItem('a', 8293357), rawItem('b', 197000000, { quality: 2, video: true }), rawItem('c', 5, { notOwned: true, takesUpSpace: 0 })], null, 'NEXT_TOKEN'];
    const page = parser(data, 'omQMf') as StorageCategoryPage;
    expect(page.nextPageId).toBe('NEXT_TOKEN');
    expect(page.items).toHaveLength(3);
    expect(page.items?.[0]).toMatchObject({ mediaKey: 'a', dedupKey: 'dedup-a', size: 8293357, spaceTaken: 8293357, takesUpSpace: true, isOriginalQuality: false, isOwned: true, resWidth: 4032 });
    expect(page.items?.[1]).toMatchObject({ mediaKey: 'b', size: 197000000, isOriginalQuality: true, duration: 42000 });
    expect(page.items?.[2]).toMatchObject({ mediaKey: 'c', takesUpSpace: false, isOwned: false });
  });
  it('handles a last page without a token', () => {
    const page = parser([[rawItem('a', 1)]], 'omQMf') as StorageCategoryPage;
    expect(page.nextPageId).toBeUndefined();
  });
});

function fakeApi(pages: Record<string, StorageCategoryPage>): Api {
  return {
    getStorageCategoryPage: vi.fn(async (_category: number, pageId: string | null) => pages[pageId ?? 'first']),
  } as unknown as Api;
}

const item = (key: string): MediaItem => ({ mediaKey: key, dedupKey: key, timestamp: 0, creationTimestamp: 0 });

describe('readStorageCategory', () => {
  it('follows page tokens to the end', async () => {
    const api = fakeApi({ first: { items: [item('a'), item('b')], nextPageId: 'p2' }, p2: { items: [item('c')] } });
    const seen: number[] = [];
    const items = await readStorageCategory(api, StorageCategory.Large, () => false, (p) => seen.push(p.length));
    expect(items.map((i) => i.mediaKey)).toEqual(['a', 'b', 'c']);
    expect(seen).toEqual([2, 1]);
  });
  it('stops if a page repeats (stalled pagination) instead of looping', async () => {
    const api = fakeApi({ first: { items: [item('a')], nextPageId: 'p2' }, p2: { items: [item('a')], nextPageId: 'p2' } });
    const items = await readStorageCategory(api, StorageCategory.Large);
    expect(items.map((i) => i.mediaKey)).toEqual(['a']);
  });
  it('throws ScanStoppedError when stopped', async () => {
    const api = fakeApi({ first: { items: [item('a')], nextPageId: 'p2' }, p2: { items: [item('b')] } });
    await expect(readStorageCategory(api, StorageCategory.Large, () => true)).rejects.toBeInstanceOf(ScanStoppedError);
  });
});

describe('unionItems', () => {
  it('merges lists by mediaKey, earlier lists win, later ones fill gaps', () => {
    const merged = unionItems([{ ...item('a'), size: 10 }], [{ ...item('a'), fileName: 'x.png' }, item('b')]);
    expect(merged.map((i) => i.mediaKey)).toEqual(['a', 'b']);
    expect(merged[0]).toMatchObject({ size: 10, fileName: 'x.png' });
  });
});
