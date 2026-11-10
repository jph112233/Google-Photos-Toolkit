import { describe, it, expect, vi } from 'vitest';
import { streamDuplicateGroups, newCursor, splitRuns, timelineCandidates } from '../src/cleanup/duplicates';
import type Core from '../src/gptk-core';
import type { MediaItem, LibraryTimelinePage } from '../src/types';

const MIN = 60_000;
const T0 = 1_700_000_000_000;

const photo = (key: string, ts: number, extra: Partial<MediaItem> = {}): MediaItem => ({
  mediaKey: key,
  dedupKey: `d-${key}`,
  timestamp: ts,
  creationTimestamp: ts,
  thumb: `https://example.test/${key}`,
  isOwned: true,
  ...extra,
});

/** Fake core: timeline pages newest first; batch info marks nothing as space-consuming,
 *  so no thumbnails are fetched and only the cursor logic is exercised. */
function fakeCore(pages: LibraryTimelinePage[]): { core: Core; infoCalls: string[][] } {
  const infoCalls: string[][] = [];
  const byId: Record<string, LibraryTimelinePage> = {};
  pages.forEach((p, i) => (byId[i === 0 ? 'first' : `p${i}`] = p));
  const core = {
    isProcessRunning: true,
    api: {
      getItemsByTakenDate: vi.fn(async (_ts: number | null, _src: string | null, pageId: string | null) => byId[pageId ?? 'first']),
      getBatchMediaInfo: vi.fn(async (keys: string[]) => {
        infoCalls.push(keys);
        return keys.map((mediaKey) => ({ mediaKey, takesUpSpace: false }));
      }),
    },
  } as unknown as Core;
  return { core, infoCalls };
}

describe('splitRuns / timelineCandidates', () => {
  it('keeps singletons and caps run size', () => {
    const items = [photo('a', T0), photo('b', T0 + MIN), photo('c', T0 + 60 * MIN)];
    expect(splitRuns(items).map((r) => r.map((i) => i.mediaKey))).toEqual([['a', 'b'], ['c']]);
  });
  it('drops videos, partner items and items without thumbs', () => {
    const items = [photo('ok', T0), photo('vid', T0, { duration: 5000 }), photo('theirs', T0, { isOwned: false }), photo('nothumb', T0, { thumb: undefined })];
    expect(timelineCandidates(items).map((i) => i.mediaKey)).toEqual(['ok']);
  });
});

describe('streamDuplicateGroups (cursor logic)', () => {
  const pages: LibraryTimelinePage[] = [
    // Page 1 (newest): a burst at T0+100min, plus the start of a burst that continues on page 2.
    { items: [photo('n1', T0 + 100 * MIN), photo('n2', T0 + 100 * MIN - 1000), photo('x1', T0 + 30 * MIN)], nextPageId: 'p1', lastItemTimestamp: T0 + 30 * MIN },
    // Page 2: continues the T0+30min burst, then an old pair.
    { items: [photo('x2', T0 + 29 * MIN), photo('o1', T0), photo('o2', T0 - 1000)], nextPageId: undefined, lastItemTimestamp: T0 - 1000 },
  ];

  it('walks every page, carries a burst across the page boundary, and finishes', async () => {
    const { core, infoCalls } = fakeCore(pages);
    const progress: number[] = [];
    const cursor = await streamDuplicateGroups(core, { eligibility: {}, onProgress: (p) => progress.push(p.cursor.itemsSeen) });
    expect(cursor.done).toBe(true);
    expect(cursor.itemsSeen).toBe(6);
    expect(progress).toEqual([3, 6]);
    expect(cursor.checkedBackTo).toBe(T0 - 1000);
    // Page 1 only sends the complete newest burst; x1 is carried and checked with x2.
    expect(infoCalls[0].sort()).toEqual(['n1', 'n2']);
    expect(infoCalls[1].sort()).toEqual(['o1', 'o2', 'x1', 'x2']);
  });

  it('resumes from a saved cursor without re-reading earlier pages', async () => {
    const { core } = fakeCore(pages);
    let saved = newCursor();
    let calls = 0;
    // Stop right after the first page is processed.
    saved = await streamDuplicateGroups(core, {
      eligibility: {},
      onProgress: () => {
        calls++;
        (core as { isProcessRunning: boolean }).isProcessRunning = false;
      },
    });
    expect(calls).toBe(1);
    expect(saved.done).toBe(false);
    expect(saved.pageId).toBe('p1');
    expect(saved.carry.map((i) => i.mediaKey)).toEqual(['x1']);

    (core as { isProcessRunning: boolean }).isProcessRunning = true;
    const getPage = core.api.getItemsByTakenDate as ReturnType<typeof vi.fn>;
    getPage.mockClear();
    const final = await streamDuplicateGroups(core, { eligibility: {}, cursor: saved });
    expect(final.done).toBe(true);
    expect(final.itemsSeen).toBe(6);
    expect(getPage).toHaveBeenCalledTimes(1);
    expect(getPage.mock.calls[0][2]).toBe('p1');
  });

  it('returns immediately for a finished cursor', async () => {
    const { core } = fakeCore(pages);
    const done = { ...newCursor(), done: true };
    expect(await streamDuplicateGroups(core, { eligibility: {}, cursor: done })).toEqual(done);
    expect(core.api.getItemsByTakenDate).not.toHaveBeenCalled();
  });
});
