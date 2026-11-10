// Human-friendly formatting for the cleanup wizard.

const UNITS = ['B', 'KB', 'MB', 'GB', 'TB'];

/** 44_350_000_000 > "41.3 GB". Uses binary (1024) steps, like Google's storage page. */
export function formatBytes(bytes: number | null | undefined): string {
  const value = Number(bytes);
  if (!Number.isFinite(value) || value <= 0) return '0 B';
  let unit = 0;
  let n = value;
  while (n >= 1024 && unit < UNITS.length - 1) {
    n /= 1024;
    unit++;
  }
  if (unit === 0) return `${Math.round(n)} B`;
  // One decimal below 100 (41.3 GB), none above (312 MB).
  const text = n < 100 ? n.toFixed(1).replace(/\.0$/, '') : String(Math.round(n));
  return `${text} ${UNITS[unit]}`;
}

/** Format a byte range with a shared unit: (60 GB, 90 GB) > "60-90 GB". */
export function formatBytesRange(low: number, high: number): string {
  const lo = formatBytes(low);
  const hi = formatBytes(high);
  const [loNum, loUnit] = lo.split(' ');
  const [hiNum, hiUnit] = hi.split(' ');
  if (loUnit === hiUnit) return loNum === hiNum ? hi : `${loNum}-${hiNum} ${hiUnit}`;
  return `${lo}-${hi}`;
}

/** 102_000 ms > "1:42", 3_723_000 ms > "1:02:03". */
export function formatDuration(ms: number | null | undefined): string {
  const value = Number(ms);
  if (!Number.isFinite(value) || value <= 0) return '0:00';
  const totalSeconds = Math.round(value / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const ss = String(seconds).padStart(2, '0');
  if (hours > 0) return `${hours}:${String(minutes).padStart(2, '0')}:${ss}`;
  return `${minutes}:${ss}`;
}

/** 41200 > "41,200". */
export function formatCount(n: number): string {
  return Math.round(n).toLocaleString('en-US');
}

/** "1 video" / "128 videos". */
export function plural(n: number, singular: string, pluralForm = `${singular}s`): string {
  return `${formatCount(n)} ${n === 1 ? singular : pluralForm}`;
}

/** Rough "about 4 min" style estimate. */
export function formatEta(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return 'almost done';
  const minutes = Math.round(ms / 60000);
  if (minutes < 1) return 'less than a minute left';
  if (minutes === 1) return 'about 1 minute left';
  return `about ${minutes} minutes left`;
}
