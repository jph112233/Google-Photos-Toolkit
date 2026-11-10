// Quick scan for the cleanup wizard. Read-only: nothing here changes the
// library. Results stay in memory; only a size summary is saved.
//
// Instead of walking the whole library (slow for 100k+ item libraries), the
// quick scan reads Google's own "Manage storage" review lists, which Google
// computes server-side: Large photos & videos (roughly biggest first, with
// sizes), Screenshots, Other apps and Blurry. Its cost grows with the number
// of quick wins, not with library size. Look-alikes stream through the
// timeline separately (see duplicates.ts).
import splitArrayIntoChunks from '../utils/splitArrayIntoChunks';
import { defer } from '../utils/helpers';
import { StorageCategory } from '../types';
import type { MediaItem, StorageQuota, BulkMediaInfo } from '../types';
import type Api from '../api/api';
import type Core from '../gptk-core';

export interface ScanSources {
  /** Google's "Large photos & videos" list. */
  large: Set<string>;
  /** Google's "Screenshots" list. */
  googleScreenshots: Set<string>;
  /** Google's "Other apps" list. */
  otherApps: Set<string>;
  /** Google's "Blurry photos" list. */
  blurry: Set<string>;
  /** Google Photos search for "screenshots" (noisy; PNGs only are trusted). */
  search: Set<string>;
}

export interface ScanResult {
  quota: StorageQuota;
  /** Union of all quick-win items, extended with fileName/size/takesUpSpace/quality. */
  items: MediaItem[];
  sources: ScanSources;
  /** dedupKeys of items in shared links / shared albums. */
  sharedDedupKeys: Set<string>;
  /** False until the (background) shared-album check has finished. */
  sharedChecked: boolean;
  trash: { count: number; bytes: number };
  scannedAt: number;
}

export type ScanPhase = 'quota' | 'large' | 'lists' | 'details' | 'trash' | 'done';

export const SCAN_PHASES: Array<{ id: ScanPhase; label: string }> = [
  { id: 'large', label: 'Finding your biggest files' },
  { id: 'lists', label: 'Finding screenshots and blurry shots' },
  { id: 'details', label: 'Getting file details' },
  { id: 'trash', label: 'Checking your Trash' },
];

export interface ScanProgress {
  phase: ScanPhase;
  done: number;
  total: number;
  /** Quick-win items found so far. */
  itemCount: number;
  /** Bytes in the Large list found so far. */
  largeBytes: number;
  fraction: number;
  etaMs?: number;
  quota?: StorageQuota;
}

const PHASE_WEIGHT: Record<ScanPhase, [number, number]> = {
  quota: [0, 0.03],
  large: [0.03, 0.6],
  lists: [0.6, 0.75],
  details: [0.75, 0.95],
  trash: [0.95, 1],
  done: [1, 1],
};

/** Safety cap so a pathological response can't page forever. */
const MAX_CATEGORY_PAGES = 2000;

export class ScanStoppedError extends Error {
  constructor() {
    super('Scan stopped');
    this.name = 'ScanStoppedError';
  }
}

function overall(phase: ScanPhase, local: number): number {
  const [a, b] = PHASE_WEIGHT[phase];
  return a + (b - a) * Math.max(0, Math.min(1, local));
}

/** Merge batch media info into items by mediaKey, never overwriting with undefined/null. */
export function mergeMediaInfo(items: MediaItem[], info: BulkMediaInfo[]): MediaItem[] {
  const byKey = new Map(info.filter((i) => i?.mediaKey).map((i) => [i.mediaKey, i]));
  return items.map((item) => {
    const extra = byKey.get(item.mediaKey);
    if (!extra) return item;
    const merged: MediaItem = { ...item };
    for (const [k, v] of Object.entries(extra)) {
      if (v !== undefined && v !== null) (merged as unknown as Record<string, unknown>)[k] = v;
    }
    return merged;
  });
}

/** Union of item lists by mediaKey; later lists only fill gaps. */
export function unionItems(...lists: MediaItem[][]): MediaItem[] {
  const byKey = new Map<string, MediaItem>();
  for (const list of lists) {
    for (const item of list) {
      if (!item?.mediaKey) continue;
      const existing = byKey.get(item.mediaKey);
      byKey.set(item.mediaKey, existing ? { ...item, ...existing } : item);
    }
  }
  return [...byKey.values()];
}

export function emptySources(): ScanSources {
  return { large: new Set(), googleScreenshots: new Set(), otherApps: new Set(), blurry: new Set(), search: new Set() };
}

/** Read every page of one "Manage storage" list. */
export async function readStorageCategory(
  api: Api,
  category: StorageCategory,
  shouldStop: () => boolean = () => false,
  onPage: (items: MediaItem[]) => void = () => {}
): Promise<MediaItem[]> {
  const items: MediaItem[] = [];
  const seen = new Set<string>();
  let pageId: string | null = null;
  let pages = 0;
  do {
    if (shouldStop()) throw new ScanStoppedError();
    const page = await api.getStorageCategoryPage(category, pageId);
    const fresh = (page.items ?? []).filter((i) => i?.mediaKey && !seen.has(i.mediaKey));
    for (const i of fresh) seen.add(i.mediaKey);
    items.push(...fresh);
    onPage(fresh);
    // A repeated page means pagination stalled; stop rather than loop.
    if (!fresh.length) break;
    pageId = page.nextPageId ?? null;
    pages++;
  } while (pageId && pages < MAX_CATEGORY_PAGES);
  return items;
}

/**
 * Shared-album membership (same source as the Advanced "exclude shared"
 * filter). Runs without touching core.isProcessRunning so it can finish in
 * the background while the person already browses results.
 */
export async function findSharedDedupKeys(api: Api, onProgress: (done: number, total: number) => void = () => {}): Promise<Set<string>> {
  const links: Array<{ linkId: string }> = [];
  let pageId: string | undefined;
  do {
    const page = await api.getSharedLinks(pageId ?? null);
    for (const link of page?.items ?? []) if (link?.linkId) links.push(link);
    pageId = page?.nextPageId;
  } while (pageId);

  const keys = new Set<string>();
  let next = 0;
  let done = 0;
  const worker = async (): Promise<void> => {
    while (next < links.length) {
      const link = links[next++];
      let albumPage: string | null = null;
      do {
        const page = await api.getAlbumPage(link.linkId, albumPage);
        for (const item of page?.items ?? []) if (item?.dedupKey) keys.add(item.dedupKey);
        albumPage = page?.nextPageId ?? null;
      } while (albumPage);
      done++;
      onProgress(done, links.length);
    }
  };
  await Promise.all(Array.from({ length: Math.min(8, links.length) }, () => worker()));
  return keys;
}

export default class Scanner {
  private startedAt = 0;
  private quota: StorageQuota | undefined;
  private itemCount = 0;
  private largeBytes = 0;

  constructor(
    private core: Core,
    private onProgress: (p: ScanProgress) => void = () => {}
  ) {}

  private stopped = (): boolean => !this.core.isProcessRunning;

  private check(): void {
    if (this.stopped()) throw new ScanStoppedError();
  }

  private report(phase: ScanPhase, done: number, total: number): void {
    const local = total > 0 ? done / total : 0;
    const fraction = overall(phase, local);
    const elapsed = Date.now() - this.startedAt;
    const etaMs = fraction > 0.05 ? (elapsed / fraction) * (1 - fraction) : undefined;
    this.onProgress({ phase, done, total, itemCount: this.itemCount, largeBytes: this.largeBytes, fraction, etaMs, quota: this.quota });
  }

  /** Batch media info (fileName, size, takesUpSpace, quality) for the quick-win items. */
  async extendWithInfo(items: MediaItem[]): Promise<MediaItem[]> {
    if (!items.length) return items;
    const utils = this.core.apiUtils;
    const chunkSize = Math.max(1, utils?.infoSize || 5000);
    const concurrency = Math.max(1, utils?.maxConcurrentBatchApiReq || 3);
    const chunks = splitArrayIntoChunks(items.map((i) => i.mediaKey), chunkSize);
    const info: BulkMediaInfo[] = [];
    let done = 0;
    let next = 0;
    const worker = async (): Promise<void> => {
      while (next < chunks.length) {
        this.check();
        const chunk = chunks[next++];
        try {
          const result = await this.core.api.getBatchMediaInfo(chunk);
          if (Array.isArray(result)) info.push(...result);
        } catch (error) {
          console.error('[GPTK] Batch media info failed for a chunk', error);
        }
        done += chunk.length;
        this.report('details', done, items.length);
      }
    };
    await Promise.all(Array.from({ length: Math.min(concurrency, chunks.length) }, () => worker()));
    this.check();
    return mergeMediaInfo(items, info);
  }

  async searchScreenshots(): Promise<MediaItem[]> {
    const items: MediaItem[] = [];
    let pageId: string | null = null;
    do {
      this.check();
      try {
        const page = await this.core.api.search('screenshots', pageId);
        items.push(...(page?.items ?? []).filter((i) => i?.mediaKey));
        pageId = page?.nextPageId ?? null;
      } catch (error) {
        console.error('[GPTK] Screenshot search failed', error);
        break;
      }
    } while (pageId);
    return items;
  }

  /** Trash item count. Google returns no size info for trashed items. */
  async countTrash(): Promise<{ count: number; bytes: number }> {
    let count = 0;
    let pageId: string | null = null;
    do {
      const page = await this.core.api.getTrashItems(pageId);
      count += page?.items?.length ?? 0;
      pageId = page?.nextPageId ?? null;
    } while (pageId);
    return { count, bytes: 0 };
  }

  async run(): Promise<ScanResult> {
    this.startedAt = Date.now();
    const api = this.core.api;
    this.report('quota', 0, 1);
    let quota: StorageQuota = {};
    try {
      quota = await api.getStorageQuota();
      this.quota = quota;
    } catch (error) {
      console.error('[GPTK] Storage quota failed', error);
    }
    this.check();

    // Large list is the long pole; the small lists run alongside it.
    const used = Number(quota.usedByGPhotos ?? quota.totalUsed ?? 0);
    const large = readStorageCategory(api, StorageCategory.Large, this.stopped, (page) => {
      this.itemCount += page.length;
      for (const i of page) this.largeBytes += i.size ?? 0;
      // Large typically holds most of the bytes; track progress against usage.
      this.report('large', this.largeBytes, used > 0 ? used * 0.8 : this.largeBytes * 2 || 1);
    });
    const safeList = async (category: StorageCategory): Promise<MediaItem[]> => {
      try {
        return await readStorageCategory(api, category, this.stopped);
      } catch (error) {
        if (error instanceof ScanStoppedError) throw error;
        console.error(`[GPTK] Storage list ${category} failed`, error);
        return [];
      }
    };
    const [largeItems, screenshotItems, otherAppItems, blurryItems, searchItems] = await Promise.all([
      large,
      safeList(StorageCategory.Screenshots),
      safeList(StorageCategory.OtherApps),
      safeList(StorageCategory.Blurry),
      this.searchScreenshots(),
    ]);
    this.report('lists', 1, 1);
    this.check();

    const keysOf = (list: MediaItem[]): Set<string> => new Set(list.map((i) => i.mediaKey));
    const sources: ScanSources = {
      large: keysOf(largeItems),
      googleScreenshots: keysOf(screenshotItems),
      otherApps: keysOf(otherAppItems),
      blurry: keysOf(blurryItems),
      search: keysOf(searchItems),
    };
    const union = unionItems(largeItems, screenshotItems, otherAppItems, blurryItems, searchItems);
    this.itemCount = union.length;
    const items = await this.extendWithInfo(union);

    this.report('trash', 0, 1);
    let trash = { count: 0, bytes: 0 };
    try {
      trash = await this.countTrash();
    } catch (error) {
      console.error('[GPTK] Trash check failed', error);
    }
    this.report('done', 1, 1);
    await defer(() => {});

    return { quota, items, sources, sharedDedupKeys: new Set(), sharedChecked: false, trash, scannedAt: Date.now() };
  }
}

export async function refreshTrashAndQuota(core: Core): Promise<{ quota: StorageQuota; trash: { count: number; bytes: number } }> {
  const scanner = new Scanner(core);
  const quota = await core.api.getStorageQuota().catch((): StorageQuota => ({}));
  const trash = await scanner.countTrash();
  return { quota, trash };
}
