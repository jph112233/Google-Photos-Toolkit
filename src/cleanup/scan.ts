// One-pass library scan for the cleanup wizard. Read-only: nothing here
// changes the library. Results stay in memory; only a size summary is saved.
import splitArrayIntoChunks from '../utils/splitArrayIntoChunks';
import { defer } from '../utils/helpers';
import { totals } from './categories';
import type { MediaItem, StorageQuota, BulkMediaInfo } from '../types';
import type Core from '../gptk-core';

export interface ScanResult {
  quota: StorageQuota;
  /** Owned library items, extended with size/takesUpSpace/isOriginalQuality/fileName. */
  items: MediaItem[];
  /** mediaKeys returned by Google Photos' own "screenshots" search. */
  screenshotKeys: Set<string>;
  /** dedupKeys of items in shared links / shared albums. */
  sharedDedupKeys: Set<string>;
  trash: { count: number; bytes: number };
  scannedAt: number;
}

export type ScanPhase = 'quota' | 'library' | 'sizes' | 'screenshots' | 'shared' | 'trash' | 'done';

export const SCAN_PHASES: Array<{ id: ScanPhase; label: string }> = [
  { id: 'library', label: 'Reading your library' },
  { id: 'sizes', label: 'Getting file sizes' },
  { id: 'screenshots', label: 'Finding screenshots' },
  { id: 'shared', label: 'Checking shared albums' },
  { id: 'trash', label: 'Checking your Trash' },
];

export interface ScanProgress {
  phase: ScanPhase;
  /** Items handled in this phase. */
  done: number;
  /** Total for this phase when known, else 0. */
  total: number;
  /** Library item count found so far. */
  itemCount: number;
  /** Overall 0..1 estimate. */
  fraction: number;
  /** Estimated ms remaining, when known. */
  etaMs?: number;
  /** Storage quota, once fetched (so the storage bar can show early). */
  quota?: StorageQuota;
}

// Rough share of total scan time per phase, for the overall progress bar.
const PHASE_WEIGHT: Record<ScanPhase, [number, number]> = {
  quota: [0, 0.02],
  library: [0.02, 0.45],
  sizes: [0.45, 0.85],
  screenshots: [0.85, 0.9],
  shared: [0.9, 0.95],
  trash: [0.95, 1],
  done: [1, 1],
};

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

/** Merge batch media info into items by mediaKey. */
export function mergeMediaInfo(items: MediaItem[], info: BulkMediaInfo[]): MediaItem[] {
  const byKey = new Map(info.filter((i) => i?.mediaKey).map((i) => [i.mediaKey, i]));
  return items.map((item) => {
    const extra = byKey.get(item.mediaKey);
    if (!extra) return item;
    // Batch info has no owner flag; keep the library's.
    const merged: MediaItem = { ...item };
    for (const [k, v] of Object.entries(extra)) {
      if (v !== undefined) (merged as unknown as Record<string, unknown>)[k] = v;
    }
    return merged;
  });
}

export default class Scanner {
  private startedAt = 0;
  private quota: StorageQuota | undefined;

  constructor(private core: Core, private onProgress: (p: ScanProgress) => void = () => {}) {}

  private check(): void {
    if (!this.core.isProcessRunning) throw new ScanStoppedError();
  }

  private report(phase: ScanPhase, done: number, total: number, itemCount: number): void {
    const local = total > 0 ? done / total : 0;
    const fraction = overall(phase, local);
    const elapsed = Date.now() - this.startedAt;
    const etaMs = fraction > 0.05 ? (elapsed / fraction) * (1 - fraction) : undefined;
    this.onProgress({ phase, done, total, itemCount, fraction, etaMs, quota: this.quota });
  }

  /** Full library by taken date (archive included), same RPC as the Library source. */
  async readLibrary(): Promise<MediaItem[]> {
    const api = this.core.api;
    const items: MediaItem[] = [];
    let nextPageId: string | null = null;
    let nextPageTimestamp: number | null = null;
    let emptyPages = 0;
    do {
      this.check();
      const page = await api.getItemsByTakenDate(nextPageTimestamp, null, nextPageId);
      if (!page) {
        if (++emptyPages > 3) break;
        continue;
      }
      nextPageId = page.nextPageId ?? null;
      nextPageTimestamp = Number.isFinite(page.lastItemTimestamp) ? page.lastItemTimestamp - 1 : null;
      if (page.items?.length) items.push(...page.items);
      // Library size is unknown up front; ease toward the phase end.
      this.report('library', items.length, items.length + 5000, items.length);
    } while (nextPageId);
    return items;
  }

  /** Batch media info (size, takesUpSpace, quality, fileName) with progress. */
  async extendWithInfo(items: MediaItem[], phase: ScanPhase, itemCount: number): Promise<MediaItem[]> {
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
        this.report(phase, done, items.length, itemCount);
      }
    };
    await Promise.all(Array.from({ length: Math.min(concurrency, chunks.length) }, () => worker()));
    this.check();
    return mergeMediaInfo(items, info);
  }

  async findScreenshotKeys(itemCount: number): Promise<Set<string>> {
    const keys = new Set<string>();
    let nextPageId: string | null = null;
    let pages = 0;
    do {
      this.check();
      try {
        const page = await this.core.api.search('screenshots', nextPageId);
        for (const item of page?.items ?? []) if (item?.mediaKey) keys.add(item.mediaKey);
        nextPageId = page?.nextPageId ?? null;
      } catch (error) {
        console.error('[GPTK] Screenshot search failed', error);
        break;
      }
      pages++;
      this.report('screenshots', pages, pages + 2, itemCount);
    } while (nextPageId);
    return keys;
  }

  /** Same source as the Advanced "exclude shared" filter: shared links' items. */
  async findSharedDedupKeys(itemCount: number): Promise<Set<string>> {
    const keys = new Set<string>();
    const utils = this.core.apiUtils;
    try {
      const links = await utils.getAllSharedLinks();
      this.check();
      let done = 0;
      let next = 0;
      // Many accounts have hundreds of tiny shared links; fetch several at once.
      const concurrency = Math.max(1, Math.min(8, utils.maxConcurrentSingleApiReq || 8));
      const worker = async (): Promise<void> => {
        while (next < links.length) {
          this.check();
          const link = links[next++];
          const media = await utils.getAllMediaInSharedLink(link.linkId);
          for (const item of media) if (item?.dedupKey) keys.add(item.dedupKey);
          done++;
          this.report('shared', done, links.length, itemCount);
        }
      };
      await Promise.all(Array.from({ length: Math.min(concurrency, links.length) }, () => worker()));
    } catch (error) {
      if (error instanceof ScanStoppedError) throw error;
      console.error('[GPTK] Shared album check failed', error);
    }
    this.check();
    return keys;
  }

  async readTrash(itemCount: number): Promise<{ count: number; bytes: number }> {
    this.report('trash', 0, 1, itemCount);
    const trashItems = await this.core.apiUtils.getAllTrashItems();
    this.check();
    const extended = await this.extendWithInfo(trashItems, 'trash', itemCount);
    return totals(extended);
  }

  async run(): Promise<ScanResult> {
    this.startedAt = Date.now();
    this.report('quota', 0, 1, 0);
    let quota: StorageQuota = {};
    try {
      quota = await this.core.api.getStorageQuota();
      this.quota = quota;
    } catch (error) {
      console.error('[GPTK] Storage quota failed', error);
    }
    this.check();

    const library = await this.readLibrary();
    // Owner flag comes from the library listing; drop partner/shared items early.
    const owned = library.filter((item) => item.isOwned !== false);
    const items = await this.extendWithInfo(owned, 'sizes', owned.length);
    const screenshotKeys = await this.findScreenshotKeys(items.length);
    const sharedDedupKeys = await this.findSharedDedupKeys(items.length);
    const trash = await this.readTrash(items.length);
    this.report('done', 1, 1, items.length);
    await defer(() => {});

    return { quota, items, screenshotKeys, sharedDedupKeys, trash, scannedAt: Date.now() };
  }
}

export async function refreshTrashAndQuota(core: Core): Promise<{ quota: StorageQuota; trash: { count: number; bytes: number } }> {
  const scanner = new Scanner(core);
  const quota = await core.api.getStorageQuota().catch(() => ({}));
  const trash = await scanner.readTrash(0);
  return { quota, trash };
}
