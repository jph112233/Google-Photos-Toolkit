import { describe, it, expect } from 'vitest';
import {
  MB,
  isEligible,
  bigVideos,
  isScreenRecording,
  isLongVideo,
  screenshotKind,
  screenshots,
  originalQualityStats,
  duplicateCandidates,
  totals,
  bytesOf,
  withoutKeys,
} from '../src/cleanup/categories';
import { makeItem } from './fixtures';

const owned = { isOwned: true, takesUpSpace: true } as const;

describe('isEligible (safety gate)', () => {
  it('accepts owned, space-consuming items', () => {
    expect(isEligible(makeItem({ ...owned }))).toBe(true);
  });
  it('rejects items she does not own', () => {
    expect(isEligible(makeItem({ ...owned, isOwned: false }))).toBe(false);
  });
  it('rejects items that do not take up space, or unknown', () => {
    expect(isEligible(makeItem({ ...owned, takesUpSpace: false }))).toBe(false);
    expect(isEligible(makeItem({ ...owned, takesUpSpace: null }))).toBe(false);
    expect(isEligible(makeItem({ isOwned: true }))).toBe(false);
  });
  it('excludes favorites by default, includes them on request', () => {
    const fav = makeItem({ ...owned, isFavorite: true });
    expect(isEligible(fav)).toBe(false);
    expect(isEligible(fav, { includeFavorites: true })).toBe(true);
  });
  it('excludes shared-album items by default, includes them on request', () => {
    const item = makeItem({ ...owned, dedupKey: 'shared-1' });
    const sharedDedupKeys = new Set(['shared-1']);
    expect(isEligible(item, { sharedDedupKeys })).toBe(false);
    expect(isEligible(item, { sharedDedupKeys, includeShared: true })).toBe(true);
  });
});

describe('bigVideos', () => {
  const items = [
    makeItem({ ...owned, duration: 30_000, size: 60 * MB, mediaKey: 'v60' }),
    makeItem({ ...owned, duration: 30_000, size: 500 * MB, mediaKey: 'v500' }),
    makeItem({ ...owned, duration: 30_000, size: 50 * MB, mediaKey: 'v50' }),
    makeItem({ ...owned, size: 900 * MB, mediaKey: 'photo' }),
    makeItem({ ...owned, duration: 30_000, size: 800 * MB, isOwned: false, mediaKey: 'notmine' }),
    makeItem({ ...owned, duration: 30_000, size: 800 * MB, takesUpSpace: false, mediaKey: 'free' }),
    makeItem({ ...owned, duration: 30_000, size: 800 * MB, isFavorite: true, mediaKey: 'fav' }),
  ];
  it('keeps eligible videos strictly over 50 MB, largest first', () => {
    expect(bigVideos(items).map((i) => i.mediaKey)).toEqual(['v500', 'v60']);
  });
  it('can include favorites', () => {
    expect(bigVideos(items, { includeFavorites: true }).map((i) => i.mediaKey)).toEqual(['fav', 'v500', 'v60']);
  });
});

describe('video chips', () => {
  it('detects screen recordings by filename', () => {
    for (const name of ['RPReplay_Final1680.MP4', 'ScreenRecording_01.mp4', 'Screen_Recording_20240101.mp4', 'screen-record-1.mp4', 'screenrecord.mp4']) {
      expect(isScreenRecording(makeItem({ fileName: name }))).toBe(true);
    }
    expect(isScreenRecording(makeItem({ fileName: 'IMG_1234.MOV' }))).toBe(false);
    expect(isScreenRecording(makeItem({}))).toBe(false);
  });
  it('detects videos longer than one minute', () => {
    expect(isLongVideo(makeItem({ duration: 61_000 }))).toBe(true);
    expect(isLongVideo(makeItem({ duration: 60_000 }))).toBe(false);
  });
});

describe('screenshotKind', () => {
  const cases: Array<[string, string | null]> = [
    ['Screenshot_20240101-101010.png', 'screenshot'],
    ['Screen Shot 2023-01-01 at 10.00.00.png', 'screenshot'],
    ['SCR-20240101-abc.png', 'screenshot'],
    ['Snapchat-123456789.jpg', 'snapchat'],
    ['IMG-20240101-WA0001.jpg', 'whatsapp'],
    ['VID-20240101-WA0002.mp4', 'whatsapp'],
    ['received_1234567890.jpeg', 'otherApps'],
    ['FB_IMG_1600000000000.jpg', 'otherApps'],
    ['Instagram_post.jpg', 'otherApps'],
    ['TikTok_video.mp4', 'otherApps'],
    ['1234567890123456789.mp4', 'otherApps'],
    ['IMG_1234.HEIC', null],
    ['123456789012345678.mp4', null],
  ];
  for (const [name, kind] of cases) {
    it(`${name} -> ${String(kind)}`, () => {
      expect(screenshotKind(makeItem({ fileName: name }))).toBe(kind);
    });
  }
  it('uses the Google search result keys as a fallback for PNG files', () => {
    const item = makeItem({ fileName: 'IMG_9999.PNG', mediaKey: 'from-search' });
    expect(screenshotKind(item, new Set(['from-search']))).toBe('screenshot');
  });
  it('ignores search hits that are camera photos or videos', () => {
    const keys = new Set(['heic', 'jpg', 'vid', 'noname']);
    expect(screenshotKind(makeItem({ fileName: 'IMG_1.HEIC', mediaKey: 'heic' }), keys)).toBeNull();
    expect(screenshotKind(makeItem({ fileName: 'IMG_2.JPG', mediaKey: 'jpg' }), keys)).toBeNull();
    expect(screenshotKind(makeItem({ fileName: 'IMG_3.MOV', mediaKey: 'vid' }), keys)).toBeNull();
    expect(screenshotKind(makeItem({ mediaKey: 'noname' }), keys)).toBeNull();
  });
});

describe('screenshots', () => {
  it('unions filename and search matches, de-duplicates, keeps only eligible, largest first', () => {
    const a = makeItem({ ...owned, fileName: 'Screenshot_1.png', size: 1 * MB, mediaKey: 'a' });
    const b = makeItem({ ...owned, fileName: 'IMG_1.png', size: 3 * MB, mediaKey: 'b' });
    const c = makeItem({ ...owned, fileName: 'Snapchat-1.jpg', size: 2 * MB, mediaKey: 'c', isOwned: false });
    const d = makeItem({ ...owned, fileName: 'IMG_2.png', size: 5 * MB, mediaKey: 'd' });
    const e = makeItem({ ...owned, fileName: 'IMG_3.JPG', size: 9 * MB, mediaKey: 'e' });
    const result = screenshots([a, b, c, d, e, a], new Set(['b', 'e']));
    expect(result.map((i) => i.mediaKey)).toEqual(['b', 'a']);
  });
});

describe('originalQualityStats', () => {
  it('sums owned, space-consuming Original-quality items and estimates a range', () => {
    const GB = 1024 ** 3;
    const items = [
      makeItem({ ...owned, isOriginalQuality: true, size: 10 * GB }),
      makeItem({ ...owned, isOriginalQuality: true, size: 10 * GB, isFavorite: true }),
      makeItem({ ...owned, isOriginalQuality: false, size: 50 * GB }),
      makeItem({ ...owned, isOriginalQuality: true, size: 50 * GB, isOwned: false }),
    ];
    const stats = originalQualityStats(items);
    expect(stats.count).toBe(2);
    expect(stats.bytes).toBe(20 * GB);
    expect(stats.savingsLow).toBeLessThan(stats.savingsHigh);
    expect(stats.savingsHigh).toBeLessThan(stats.bytes);
  });
});

describe('duplicateCandidates', () => {
  it('keeps eligible images with thumbnails, never videos', () => {
    const items = [
      makeItem({ ...owned, thumb: 't1', mediaKey: 'img' }),
      makeItem({ ...owned, thumb: 't2', duration: 5000, mediaKey: 'vid' }),
      makeItem({ ...owned, mediaKey: 'nothumb' }),
      makeItem({ ...owned, thumb: 't3', isFavorite: true, mediaKey: 'fav' }),
    ];
    expect(duplicateCandidates(items).map((i) => i.mediaKey)).toEqual(['img']);
  });
});

describe('totals / bytesOf / withoutKeys', () => {
  it('ignores missing sizes', () => {
    expect(bytesOf(makeItem({}))).toBe(0);
    expect(totals([makeItem({ size: 5 }), makeItem({})])).toEqual({ count: 2, bytes: 5 });
  });
  it('removes by mediaKey', () => {
    const items = [makeItem({ mediaKey: 'x' }), makeItem({ mediaKey: 'y' })];
    expect(withoutKeys(items, new Set(['x'])).map((i) => i.mediaKey)).toEqual(['y']);
  });
});
