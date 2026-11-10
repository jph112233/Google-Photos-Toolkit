// Pure category logic for the cleanup wizard. No DOM, no network.
import type { MediaItem } from '../types';

export const MB = 1024 * 1024;
export const BIG_VIDEO_MIN_BYTES = 50 * MB;
export const LONG_VIDEO_MS = 60_000;

export interface EligibilityOptions {
  includeFavorites?: boolean;
  includeShared?: boolean;
  /** dedupKeys of items that appear in shared albums / shared links. */
  sharedDedupKeys?: Set<string>;
}

export interface Totals {
  count: number;
  bytes: number;
}

export function bytesOf(item: MediaItem): number {
  const size = Number(item.size);
  return Number.isFinite(size) && size > 0 ? size : 0;
}

export function totals(items: MediaItem[]): Totals {
  let bytes = 0;
  for (const item of items) bytes += bytesOf(item);
  return { count: items.length, bytes };
}

export function isVideo(item: MediaItem): boolean {
  return (item.duration ?? 0) > 0;
}

/**
 * Safety gate: only items she owns that actually count against storage.
 * Favorites and shared-album items are excluded unless explicitly included.
 */
export function isEligible(item: MediaItem, opts: EligibilityOptions = {}): boolean {
  if (item.isOwned === false) return false;
  if (item.takesUpSpace !== true) return false;
  if (!opts.includeFavorites && item.isFavorite === true) return false;
  if (!opts.includeShared && opts.sharedDedupKeys?.has(item.dedupKey)) return false;
  return true;
}

export function sortBySizeDesc(items: MediaItem[]): MediaItem[] {
  return [...items].sort((a, b) => bytesOf(b) - bytesOf(a));
}

export function sortByDateDesc(items: MediaItem[]): MediaItem[] {
  return [...items].sort((a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0));
}

export function sortByDateAsc(items: MediaItem[]): MediaItem[] {
  return [...items].sort((a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0));
}

// ─── Step 2: Big videos ─────────────────────────────────────────────

export const SCREEN_RECORDING_RE = /RPReplay|ScreenRecord|Screen_Recording|screen-?record/i;

export function isScreenRecording(item: MediaItem): boolean {
  return SCREEN_RECORDING_RE.test(item.fileName ?? '');
}

export function isLongVideo(item: MediaItem): boolean {
  return (item.duration ?? 0) > LONG_VIDEO_MS;
}

export function bigVideos(items: MediaItem[], opts: EligibilityOptions = {}, minBytes = BIG_VIDEO_MIN_BYTES): MediaItem[] {
  return sortBySizeDesc(items.filter((item) => isVideo(item) && bytesOf(item) > minBytes && isEligible(item, opts)));
}

// ─── Step 3: Screenshots and saved app media ────────────────────────

export type ScreenshotKind = 'screenshot' | 'snapchat' | 'whatsapp' | 'otherApps';

export const SCREENSHOT_KINDS: Array<{ id: ScreenshotKind; label: string }> = [
  { id: 'screenshot', label: 'Screenshots' },
  { id: 'snapchat', label: 'Snapchat' },
  { id: 'whatsapp', label: 'WhatsApp' },
  { id: 'otherApps', label: 'Other apps' },
];

export const SCREENSHOT_RE = /Screenshot|Screen Shot|SCR-\d/i;
export const SNAPCHAT_RE = /Snapchat-\d+/i;
export const WHATSAPP_RE = /IMG-\d{8}-WA\d+|VID-\d{8}-WA\d+/i;
export const SCREENSHOT_EXT_RE = /\.png$/i;
export const OTHER_APPS_RE = /^received_|FB_IMG_|Instagram|TikTok|^\d{19}\.mp4$/i;

/** Where screenshot/app candidates come from (sets of mediaKeys). */
export interface ScreenshotSources {
  /** Google's own "Screenshots" review list. */
  googleScreenshots?: Set<string>;
  /** Google's own "Other apps" review list. */
  otherApps?: Set<string>;
  /** Google Photos search for "screenshots" (noisy: only PNGs are trusted). */
  search?: Set<string>;
}

/** Which screenshot/app bucket an item falls in, or null if none. */
export function screenshotKind(item: MediaItem, sources: ScreenshotSources = {}): ScreenshotKind | null {
  const name = item.fileName ?? '';
  if (SNAPCHAT_RE.test(name)) return 'snapchat';
  if (WHATSAPP_RE.test(name)) return 'whatsapp';
  if (OTHER_APPS_RE.test(name)) return 'otherApps';
  if (SCREENSHOT_RE.test(name)) return 'screenshot';
  if (sources.otherApps?.has(item.mediaKey)) return 'otherApps';
  if (sources.googleScreenshots?.has(item.mediaKey)) return 'screenshot';
  // Google's "screenshots" search also returns ordinary camera photos, so a
  // search hit only counts when the file is a PNG (how phones save screenshots).
  if (sources.search?.has(item.mediaKey) && SCREENSHOT_EXT_RE.test(name)) return 'screenshot';
  return null;
}

export function screenshots(items: MediaItem[], sources: ScreenshotSources, opts: EligibilityOptions = {}): MediaItem[] {
  const seen = new Set<string>();
  const result: MediaItem[] = [];
  for (const item of items) {
    if (seen.has(item.mediaKey)) continue;
    if (!isEligible(item, opts)) continue;
    if (screenshotKind(item, sources) === null) continue;
    seen.add(item.mediaKey);
    result.push(item);
  }
  return sortBySizeDesc(result);
}

// ─── Blurry photos (Google's own list) ──────────────────────────────

export function blurryPhotos(items: MediaItem[], blurryKeys: Set<string>, opts: EligibilityOptions = {}): MediaItem[] {
  return sortBySizeDesc(items.filter((item) => blurryKeys.has(item.mediaKey) && !isVideo(item) && isEligible(item, opts)));
}

// ─── Step 1: Storage saver (info only) ──────────────────────────────

/** Google's recompression typically saves this share of Original-quality bytes. */
export const SAVER_RATIO_LOW = 0.35;
export const SAVER_RATIO_HIGH = 0.55;

export interface OriginalQualityStats extends Totals {
  savingsLow: number;
  savingsHigh: number;
}

export function originalQualityStats(items: MediaItem[]): OriginalQualityStats {
  // Info only, so favorites/shared still count: the setting converts everything.
  const original = items.filter((item) => item.isOwned !== false && item.takesUpSpace === true && item.isOriginalQuality === true);
  const t = totals(original);
  return {
    ...t,
    savingsLow: Math.round(t.bytes * SAVER_RATIO_LOW),
    savingsHigh: Math.round(t.bytes * SAVER_RATIO_HIGH),
  };
}

// ─── Step 4 candidates ──────────────────────────────────────────────

export function duplicateCandidates(items: MediaItem[], opts: EligibilityOptions = {}): MediaItem[] {
  return items.filter((item) => !isVideo(item) && !!item.thumb && isEligible(item, opts));
}

/** Remove items (by mediaKey) from a list, returning a new list. */
export function withoutKeys<T extends { mediaKey: string }>(items: T[], keys: Set<string>): T[] {
  return items.filter((item) => !keys.has(item.mediaKey));
}
