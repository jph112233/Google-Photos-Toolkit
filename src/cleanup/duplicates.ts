// Time-bucketed near-duplicate grouping for the cleanup wizard.
//
// The Advanced view's similarity filter compares every image with every
// group across the whole set (O(n^2)). Bursts and selfie runs are taken
// within minutes of each other, so here we only compare inside time
// buckets, which keeps 40k+ photo libraries tractable.
import { hammingDistance, generateImageHash, fetchImageBlobs } from '../filters';
import { defer } from '../utils/helpers';
import { bytesOf, isEligible, isVideo } from './categories';
import { mergeMediaInfo } from './scan';
import splitArrayIntoChunks from '../utils/splitArrayIntoChunks';
import type { EligibilityOptions } from './categories';
import type { MediaItem } from '../types';
import type Core from '../gptk-core';

export const BUCKET_WINDOW_MS = 10 * 60 * 1000;
export const MAX_BUCKET_SIZE = 150;
export const SIMILARITY_THRESHOLD = 0.9;
export const THUMB_HEIGHT = 16;
export const HASH_SIZE = 8;

export type HashedItem = MediaItem & { hash: bigint };

export interface DuplicateGroup {
  id: string;
  items: MediaItem[];
  /** mediaKey of the item pre-marked Keep. */
  keepKey: string;
}

/**
 * Split items into runs where each photo was taken within `windowMs` of the
 * previous one (ascending by time). Runs are capped at `maxSize` so one long
 * event can't become a giant bucket. Singletons are included.
 */
export function splitRuns(items: MediaItem[], windowMs = BUCKET_WINDOW_MS, maxSize = MAX_BUCKET_SIZE): MediaItem[][] {
  const sorted = [...items].filter((i) => Number.isFinite(i.timestamp)).sort((a, b) => a.timestamp - b.timestamp);
  const runs: MediaItem[][] = [];
  let current: MediaItem[] = [];
  for (const item of sorted) {
    const prev = current[current.length - 1];
    if (prev && (item.timestamp - prev.timestamp > windowMs || current.length >= maxSize)) {
      runs.push(current);
      current = [];
    }
    current.push(item);
  }
  if (current.length) runs.push(current);
  return runs;
}

/** Runs with 2+ photos: the only ones worth comparing. */
export function bucketByTime(items: MediaItem[], windowMs = BUCKET_WINDOW_MS, maxSize = MAX_BUCKET_SIZE): MediaItem[][] {
  return splitRuns(items, windowMs, maxSize).filter((b) => b.length > 1);
}

export function similarity(a: bigint, b: bigint, hashSize = HASH_SIZE): number {
  return 1 - hammingDistance(a, b) / (hashSize * hashSize);
}

/** Greedy grouping inside one bucket: join the first group whose seed is similar enough. */
export function groupByHash(items: HashedItem[], threshold = SIMILARITY_THRESHOLD, hashSize = HASH_SIZE): HashedItem[][] {
  const groups: HashedItem[][] = [];
  for (const item of items) {
    const group = groups.find((g) => similarity(g[0].hash, item.hash, hashSize) >= threshold);
    if (group) group.push(item);
    else groups.push([item]);
  }
  return groups.filter((g) => g.length > 1);
}

/** Best shot to keep: highest resolution, then largest file, then earliest. */
export function pickKeeper(items: MediaItem[]): MediaItem {
  return [...items].sort((a, b) => {
    const resDiff = (b.resWidth ?? 0) * (b.resHeight ?? 0) - (a.resWidth ?? 0) * (a.resHeight ?? 0);
    if (resDiff !== 0) return resDiff;
    const sizeDiff = bytesOf(b) - bytesOf(a);
    if (sizeDiff !== 0) return sizeDiff;
    return a.timestamp - b.timestamp;
  })[0];
}

export function toDuplicateGroup(items: MediaItem[]): DuplicateGroup {
  const ordered = [...items].sort((a, b) => a.timestamp - b.timestamp);
  return {
    id: ordered.map((i) => i.mediaKey).join('|'),
    items: ordered,
    keepKey: pickKeeper(ordered).mediaKey,
  };
}

/** Keys pre-selected for trash: everything except each group's keeper. */
export function defaultTrashKeys(groups: DuplicateGroup[]): Set<string> {
  const keys = new Set<string>();
  for (const g of groups) for (const item of g.items) if (item.mediaKey !== g.keepKey) keys.add(item.mediaKey);
  return keys;
}

/** Drop trashed items from groups; groups with fewer than 2 items left are removed. */
export function pruneGroups(groups: DuplicateGroup[], removedKeys: Set<string>): DuplicateGroup[] {
  const result: DuplicateGroup[] = [];
  for (const g of groups) {
    const items = g.items.filter((i) => !removedKeys.has(i.mediaKey));
    if (items.length < 2) continue;
    const keepKey = items.some((i) => i.mediaKey === g.keepKey) ? g.keepKey : pickKeeper(items).mediaKey;
    result.push({ id: items.map((i) => i.mediaKey).join('|'), items, keepKey });
  }
  return result;
}

/** Where a look-alike pass got to in the timeline (newest first), so it can resume. */
export interface TimelineCursor {
  timestamp: number | null;
  pageId: string | null;
  /** Oldest run from the last page, which may continue on the next page. */
  carry: MediaItem[];
  done: boolean;
  /** Oldest photo date checked so far. */
  checkedBackTo: number | null;
  itemsSeen: number;
  photosCompared: number;
}

export function newCursor(): TimelineCursor {
  return { timestamp: null, pageId: null, carry: [], done: false, checkedBackTo: null, itemsSeen: 0, photosCompared: 0 };
}

export interface DuplicateProgress {
  cursor: TimelineCursor;
  groups: number;
}

/** Photos worth considering from a timeline page: owned images with thumbnails. */
export function timelineCandidates(items: MediaItem[]): MediaItem[] {
  return items.filter((i) => i?.mediaKey && !!i.thumb && !isVideo(i) && i.isOwned !== false);
}

/** Hash and group one set of time runs. Returns new groups. */
async function groupRuns(core: Core, runs: MediaItem[][], eligibility: EligibilityOptions): Promise<{ groups: DuplicateGroup[]; compared: number }> {
  const flat = runs.flat();
  if (!flat.length) return { groups: [], compared: 0 };

  // Sizes and takesUpSpace come from batch info, so only fetch for run members.
  const info = [];
  for (const chunk of splitArrayIntoChunks(flat.map((i) => i.mediaKey), 5000)) {
    if (!core.isProcessRunning) return { groups: [], compared: 0 };
    try {
      const result = await core.api.getBatchMediaInfo(chunk);
      if (Array.isArray(result)) info.push(...result);
    } catch (error) {
      console.error('[GPTK] Batch media info failed for look-alikes', error);
    }
  }
  const eligible = mergeMediaInfo(flat, info).filter((i) => isEligible(i, eligibility));
  const buckets = bucketByTime(eligible);
  const toFetch = buckets.flat();
  if (!toFetch.length) return { groups: [], compared: 0 };

  const withBlobs = await fetchImageBlobs(toFetch, 48, THUMB_HEIGHT, core);
  const blobByKey = new Map(withBlobs.map((i) => [i.mediaKey, i.blob]));
  const groups: DuplicateGroup[] = [];
  for (const bucket of buckets) {
    if (!core.isProcessRunning) break;
    const hashed: HashedItem[] = [];
    for (const item of bucket) {
      const blob = blobByKey.get(item.mediaKey);
      if (!blob) continue;
      try {
        const hash = await generateImageHash(HASH_SIZE, blob, core);
        if (hash !== null) hashed.push({ ...item, hash });
      } catch {
        // Undecodable thumb: skip it.
      }
    }
    for (const g of groupByHash(hashed)) {
      // Strip the blob/hash so cached groups stay light.
      groups.push(toDuplicateGroup(g.map(({ hash: _hash, blob: _blob, ...rest }) => rest as MediaItem)));
    }
    await defer(() => {});
  }
  return { groups, compared: toFetch.length };
}

/**
 * Stream through the library timeline (newest first) one page at a time,
 * comparing only photos taken within 10 minutes of each other. New groups
 * are reported as they are found, so very large libraries show results
 * immediately and the pass can be stopped and resumed from the cursor.
 * Respects core.isProcessRunning for Stop.
 */
export async function streamDuplicateGroups(
  core: Core,
  opts: {
    eligibility: EligibilityOptions;
    cursor?: TimelineCursor;
    onGroups?: (groups: DuplicateGroup[]) => void;
    onProgress?: (p: DuplicateProgress) => void;
  }
): Promise<TimelineCursor> {
  let cursor: TimelineCursor = { ...(opts.cursor ?? newCursor()) };
  if (cursor.done) return cursor;
  let groupCount = 0;
  const fetchPage = (c: TimelineCursor): ReturnType<Core['api']['getItemsByTakenDate']> =>
    core.api.getItemsByTakenDate(c.timestamp, null, c.pageId);

  let pending: ReturnType<typeof fetchPage> | null = fetchPage(cursor);
  while (pending && core.isProcessRunning) {
    const page = await pending;
    const items = page?.items ?? [];
    const next: TimelineCursor = {
      ...cursor,
      pageId: page?.nextPageId ?? null,
      timestamp: Number.isFinite(page?.lastItemTimestamp) ? page.lastItemTimestamp - 1 : cursor.timestamp,
    };
    const last = !next.pageId;
    // Prefetch the next page while this one is hashed.
    pending = last ? null : fetchPage(next);

    const runs = splitRuns([...cursor.carry, ...timelineCandidates(items)]);
    // Runs are ascending; the oldest one may continue on the next page.
    const carry = !last && runs.length ? runs[0] : [];
    const complete = (!last && runs.length ? runs.slice(1) : runs).filter((r) => r.length > 1);

    const { groups, compared } = await groupRuns(core, complete, opts.eligibility);
    if (!core.isProcessRunning) break; // Page not fully processed: resume from it.

    groupCount += groups.length;
    if (groups.length) opts.onGroups?.(groups);
    const oldest = items.reduce((min, i) => (Number.isFinite(i.timestamp) && i.timestamp < min ? i.timestamp : min), cursor.checkedBackTo ?? Infinity);
    cursor = {
      ...next,
      carry,
      done: last,
      checkedBackTo: Number.isFinite(oldest) ? oldest : cursor.checkedBackTo,
      itemsSeen: cursor.itemsSeen + items.length,
      photosCompared: cursor.photosCompared + compared,
    };
    opts.onProgress?.({ cursor, groups: groupCount });
  }
  return cursor;
}
