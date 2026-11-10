import type { ScanResult, ScanProgress } from '../../cleanup/scan';
import type { DuplicateGroup, DuplicateProgress, TimelineCursor } from '../../cleanup/duplicates';
import type { EligibilityOptions, Totals } from '../../cleanup/categories';
import type Core from '../../gptk-core';
import type { MediaItem } from '../../types';

export type StepId = 'scan' | 'saver' | 'videos' | 'screenshots' | 'blurry' | 'dupes' | 'trash' | 'done';

export const STEPS: Array<{ id: StepId; label: string }> = [
  { id: 'scan', label: 'Scan' },
  { id: 'saver', label: 'Storage saver' },
  { id: 'videos', label: 'Big videos' },
  { id: 'screenshots', label: 'Screenshots' },
  { id: 'blurry', label: 'Blurry' },
  { id: 'dupes', label: 'Look-alikes' },
  { id: 'trash', label: 'Trash' },
];

export interface SavedSummary {
  scannedAt: number;
  usedBytes: number;
  totalBytes: number;
  saver: Totals & { savingsLow: number; savingsHigh: number };
  videos: Totals;
  screenshots: Totals;
  blurry: Totals;
  trash: Totals;
  freedBytes: number;
}

export interface GridPrefs {
  /** Items she un-picked (to keep). Everything else visible is selected. */
  keep: Set<string>;
  /** Active chip ids. */
  chips: Set<string>;
  sort: 'size' | 'date';
}

export interface WizardState {
  step: StepId;
  scan: ScanResult | null;
  scanning: boolean;
  progress: ScanProgress | null;
  error: string | null;
  summary: SavedSummary | null;
  freedBytes: number;
  freedCount: number;
  includeFavorites: boolean;
  includeShared: boolean;
  grid: Partial<Record<StepId, GridPrefs>>;
  dupes: { groups: DuplicateGroup[]; trashKeys: Set<string>; cursor: TimelineCursor } | null;
  dupeProgress: DuplicateProgress | null;
  dupeRunning: boolean;
  /** Background shared-album check after a scan. */
  shared: { checking: boolean; done: number; total: number; error: string | null };
  /** One-shot celebration line shown at the top of the next render. */
  flash: string | null;
  trashCheck: { checking: boolean; checkedAt: number | null; emptiedBytes: number; emptiedCount: number };
}

export interface WizardCtx {
  state: WizardState;
  core: Core;
  go(step: StepId): void;
  render(): void;
  eligibility(): EligibilityOptions;
  /** Confirm, move to Trash, update cache and counters. Resolves to items actually trashed. */
  trash(items: MediaItem[], noun: string): Promise<MediaItem[]>;
  startScan(): Promise<void>;
  /** Background shared-album check; unlocks Move to Trash when done. */
  checkShared(): Promise<void>;
  stop(): void;
  gridPrefs(step: StepId, defaults?: Partial<GridPrefs>): GridPrefs;
}

export function initialState(): WizardState {
  return {
    step: 'scan',
    scan: null,
    scanning: false,
    progress: null,
    error: null,
    summary: null,
    freedBytes: 0,
    freedCount: 0,
    includeFavorites: false,
    includeShared: false,
    grid: {},
    dupes: null,
    dupeProgress: null,
    dupeRunning: false,
    shared: { checking: false, done: 0, total: 0, error: null },
    flash: null,
    trashCheck: { checking: false, checkedAt: null, emptiedBytes: 0, emptiedCount: 0 },
  };
}
