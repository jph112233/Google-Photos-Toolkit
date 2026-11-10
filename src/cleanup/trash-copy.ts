// Pure wording helpers for the Trash step and Done screen (unit-tested).
import { formatBytes, plural } from './format';

/** Size is only known for items trashed by this wizard; say "at least" when some are older. */
export function trashSizeText(trash: { count: number; bytes: number }, knownCount: number): string {
  if (trash.bytes <= 0) return '';
  return trash.count > knownCount ? ` (at least ${formatBytes(trash.bytes)})` : ` (${formatBytes(trash.bytes)})`;
}

/** "That includes the N items you just picked", only while nothing has left Trash since. */
export function includesPickedText(freedCount: number, emptiedCount: number): string | null {
  if (!freedCount || emptiedCount > 0) return null;
  return `That includes the ${plural(freedCount, 'item')} you just picked.`;
}

/** Done-screen lines describing what happened. */
export function doneLines(freedCount: number, emptiedBytes: number, emptiedCount: number): string[] {
  const lines: string[] = [];
  if (freedCount) lines.push(`${plural(freedCount, 'item')} moved to Trash. You can get ${freedCount === 1 ? 'it' : 'them'} back for 60 days.`);
  if (emptiedBytes > 0) lines.push(`Your Trash is **${formatBytes(emptiedBytes)}** smaller than before. If you emptied it, that space is yours again.`);
  else if (emptiedCount > 0) lines.push(`Your Trash has **${plural(emptiedCount, 'item')}** fewer than before. If you emptied it, that space is yours again.`);
  else if (freedCount) lines.push('The space comes back once Trash is emptied (or after 60 days).');
  if (!freedCount && !emptiedBytes && !emptiedCount) lines.push('Nothing removed this time, and that is fine. Come back any time.');
  return lines;
}

export function doneTitle(freedBytes: number, emptiedCount: number): string {
  if (freedBytes > 0) return `You freed ${formatBytes(freedBytes)}`;
  return emptiedCount > 0 ? 'Trash emptied!' : 'All done!';
}
