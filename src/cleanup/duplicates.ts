// Time-bucketed near-duplicate grouping for the cleanup wizard.
//
// The Advanced view's similarity filter compares every image with every
// group across the whole set (O(n^2)). Bursts and selfie runs are taken
// within minutes of each other, so here we only compare inside time
// buckets, which keeps 40k+ photo libraries tractable.
import { hammingDistance, generateImageHash, fetchImageBlobs } from '../filters';
import { defer } from '../utils/helpers';
import { bytesOf } from './categories';
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
 * previous one. Runs are capped at `maxSize` so one long event can't become
 * a giant bucket. Only buckets with 2+ items are returned.
 */
export function bucketByTime(items: MediaItem[], windowMs = BUCKET_WINDOW_MS, maxSize = MAX_BUCKET_SIZE): MediaItem[][] {
  const sorted = [...items].filter((i) => Number.isFinite(i.timestamp)).sort((a, b) => a.timestamp - b.timestamp);
  const buckets: MediaItem[][] = [];
  let current: MediaItem[] = [];
  for (const item of sorted) {
    const prev = current[current.length - 1];
    if (prev && (item.timestamp - prev.timestamp > windowMs || current.length >= maxSize)) {
      buckets.push(current);
      current = [];
    }
    current.push(item);
  }
  if (current.length) buckets.push(current);
  return buckets.filter((b) => b.length > 1);
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

export interface DuplicateProgress {
  done: number;
  total: number;
  groups: number;
}

/**
 * Fetch tiny thumbs and hash only the photos that share a time bucket with
 * another photo, then group look-alikes inside each bucket.
 * Respects core.isProcessRunning for Stop.
 */
export async function findDuplicateGroups(
  core: Core,
  candidates: MediaItem[],
  onProgress: (p: DuplicateProgress) => void = () => {}
): Promise<DuplicateGroup[]> {
  const buckets = bucketByTime(candidates);
  const total = buckets.reduce((n, b) => n + b.length, 0);
  const groups: DuplicateGroup[] = [];
  let done = 0;
  onProgress({ done, total, groups: 0 });

  // Process several buckets per round so thumbnail fetches run in parallel.
  const ROUND_ITEMS = 600;
  let round: MediaItem[][] = [];
  let roundSize = 0;

  const flush = async (): Promise<void> => {
    if (!round.length) return;
    const flat = round.flat();
    const withBlobs = await fetchImageBlobs(flat, 48, THUMB_HEIGHT, core);
    const blobByKey = new Map(withBlobs.map((i) => [i.mediaKey, i.blob]));
    for (const bucket of round) {
      if (!core.isProcessRunning) return;
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
      done += bucket.length;
      onProgress({ done, total, groups: groups.length });
      await defer(() => {});
    }
    round = [];
    roundSize = 0;
  };

  for (const bucket of buckets) {
    if (!core.isProcessRunning) break;
    round.push(bucket);
    roundSize += bucket.length;
    if (roundSize >= ROUND_ITEMS) await flush();
  }
  if (core.isProcessRunning) await flush();

  return groups;
}
