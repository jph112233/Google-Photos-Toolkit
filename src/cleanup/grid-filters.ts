// Dropdown filters for the wizard's review grids. Pure: no DOM, no network.
// Every filter's first option is ALL ("Any ..."), which matches everything.
import type { MediaItem } from '../types';
import { bytesOf, isVideo, MB } from './categories';

export const ALL = 'all';
const DAY_MS = 24 * 60 * 60 * 1000;
const GB = 1024 * MB;

export interface FilterOption {
  value: string;
  label: string;
  match: (item: MediaItem) => boolean;
}

export interface GridFilter {
  id: string;
  label: string;
  options: FilterOption[];
}

const any = (label: string): FilterOption => ({ value: ALL, label, match: () => true });

/** When the photo was taken: relative ages first (old items are the safest to clear), then each year present. */
export function whenFilter(items: MediaItem[], now: number = Date.now()): GridFilter {
  const ts = (i: MediaItem): number => i.timestamp ?? 0;
  const olderThan = (value: string, label: string, days: number): FilterOption => ({
    value,
    label,
    match: (i) => ts(i) > 0 && now - ts(i) > days * DAY_MS,
  });
  const years = [...new Set(items.filter((i) => ts(i) > 0).map((i) => new Date(ts(i)).getFullYear()))].sort((a, b) => b - a);
  return {
    id: 'when',
    label: 'When',
    options: [
      any('Any time'),
      olderThan('older-6m', 'Older than 6 months', 182),
      olderThan('older-1y', 'Older than 1 year', 365),
      olderThan('older-3y', 'Older than 3 years', 3 * 365),
      ...years.map((y) => ({ value: `y${y}`, label: String(y), match: (i: MediaItem) => ts(i) > 0 && new Date(ts(i)).getFullYear() === y })),
    ],
  };
}

/** Size buckets: [value, label, min bytes (inclusive), max bytes (exclusive) or null]. */
export function sizeFilter(buckets: Array<[string, string, number, number | null]>): GridFilter {
  return {
    id: 'size',
    label: 'Size',
    options: [
      any('Any size'),
      ...buckets.map(([value, label, min, max]) => ({
        value,
        label,
        match: (i: MediaItem) => bytesOf(i) >= min && (max === null || bytesOf(i) < max),
      })),
    ],
  };
}

export const BIG_VIDEO_SIZES: Array<[string, string, number, number | null]> = [
  ['50-100mb', '50-100 MB', 0, 100 * MB],
  ['100-500mb', '100-500 MB', 100 * MB, 500 * MB],
  ['500mb-1gb', '500 MB-1 GB', 500 * MB, GB],
  ['1gb', 'Over 1 GB', GB, null],
];

export function lengthFilter(): GridFilter {
  const sec = (i: MediaItem): number => (i.duration ?? 0) / 1000;
  return {
    id: 'length',
    label: 'Length',
    options: [
      any('Any length'),
      { value: 'lt30s', label: 'Under 30 sec', match: (i) => sec(i) < 30 },
      { value: '30s-2m', label: '30 sec-2 min', match: (i) => sec(i) >= 30 && sec(i) < 120 },
      { value: '2-10m', label: '2-10 min', match: (i) => sec(i) >= 120 && sec(i) < 600 },
      { value: 'gt10m', label: 'Over 10 min', match: (i) => sec(i) >= 600 },
    ],
  };
}

export function typeFilter(): GridFilter {
  return {
    id: 'type',
    label: 'Type',
    options: [
      any('Photos and videos'),
      { value: 'photos', label: 'Photos only', match: (i) => !isVideo(i) },
      { value: 'videos', label: 'Videos only', match: (i) => isVideo(i) },
    ],
  };
}

/** 4K or larger: short side at least 2160 px. */
export function is4K(item: MediaItem): boolean {
  const w = item.resWidth ?? 0;
  const h = item.resHeight ?? 0;
  return Math.min(w, h) >= 2160;
}

export function optionCounts(items: MediaItem[], filter: GridFilter): Map<string, number> {
  return new Map(filter.options.map((o) => [o.value, o.value === ALL ? items.length : items.filter(o.match).length]));
}

/** A filter is only worth showing when at least one option narrows the list without emptying it. */
export function isUseful(items: MediaItem[], filter: GridFilter): boolean {
  const counts = optionCounts(items, filter);
  return filter.options.some((o) => o.value !== ALL && (counts.get(o.value) ?? 0) > 0 && (counts.get(o.value) ?? 0) < items.length);
}

/** Apply the chosen option of each filter. Unknown or missing values mean "any". */
export function applyFilters<T>(list: T[], filters: GridFilter[], chosen: Record<string, string>, pick: (x: T) => MediaItem): T[] {
  const active = filters
    .map((f) => f.options.find((o) => o.value === chosen[f.id]))
    .filter((o): o is FilterOption => !!o && o.value !== ALL);
  if (!active.length) return list;
  return list.filter((x) => active.every((o) => o.match(pick(x))));
}
