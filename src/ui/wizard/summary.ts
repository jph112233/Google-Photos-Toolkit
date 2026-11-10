import { bigVideos, screenshots, originalQualityStats, duplicateCandidates, totals } from '../../cleanup/categories';
import { bucketByTime } from '../../cleanup/duplicates';
import saveToStorage from '../../utils/saveToStorage';
import getFromStorage from '../../utils/getFromStorage';
import type { WizardState, SavedSummary } from './state';
import type { EligibilityOptions } from '../../cleanup/categories';

export const SUMMARY_KEY = 'gptk-wizard-summary';

export function eligibilityFrom(state: WizardState): EligibilityOptions {
  return {
    includeFavorites: state.includeFavorites,
    includeShared: state.includeShared,
    sharedDedupKeys: state.scan?.sharedDedupKeys,
  };
}

export function usedBytes(state: WizardState): { used: number; total: number } {
  const q = state.scan?.quota ?? state.progress?.quota;
  if (q) return { used: Number(q.usedByGPhotos ?? q.totalUsed ?? 0), total: Number(q.totalAvailable ?? 0) };
  if (state.summary) return { used: state.summary.usedBytes, total: state.summary.totalBytes };
  return { used: 0, total: 0 };
}

/** Size-only summary of the current scan (no keys, no thumbnails). */
export function computeSummary(state: WizardState): SavedSummary | null {
  const scan = state.scan;
  if (!scan) return null;
  const opts = eligibilityFrom(state);
  const candidates = duplicateCandidates(scan.items, opts);
  const { used, total } = usedBytes(state);
  return {
    scannedAt: scan.scannedAt,
    usedBytes: used,
    totalBytes: total,
    saver: originalQualityStats(scan.items),
    videos: totals(bigVideos(scan.items, opts)),
    screenshots: totals(screenshots(scan.items, scan.screenshotKeys, opts)),
    dupeCandidates: bucketByTime(candidates).reduce((n, b) => n + b.length, 0),
    trash: { ...scan.trash },
    freedBytes: state.freedBytes,
  };
}

export function saveSummary(state: WizardState): void {
  const summary = computeSummary(state);
  if (!summary) return;
  state.summary = summary;
  try {
    saveToStorage(SUMMARY_KEY, summary);
  } catch (error) {
    console.error('[GPTK] Could not save wizard summary', error);
  }
}

export function loadSummary(): SavedSummary | null {
  try {
    return getFromStorage<SavedSummary>(SUMMARY_KEY);
  } catch {
    return null;
  }
}
