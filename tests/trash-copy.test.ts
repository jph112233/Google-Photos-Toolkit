import { describe, it, expect } from 'vitest';
import { trashSizeText, includesPickedText, doneLines, doneTitle } from '../src/cleanup/trash-copy';

const KB = 1024;

describe('Trash step wording', () => {
  it('shows "includes the item you just picked" right after trashing', () => {
    expect(includesPickedText(1, 0)).toBe('That includes the 1 item you just picked.');
  });
  it('drops that line once Re-check sees items leave Trash (restore or empty)', () => {
    // Live case: 1 item trashed (18 -> 19), restored, Re-check saw 19 -> 18.
    expect(includesPickedText(1, 1)).toBeNull();
  });
  it('says nothing when nothing was picked', () => {
    expect(includesPickedText(0, 0)).toBeNull();
  });
  it('size text: exact when every item is known, "at least" when older items exist, blank when unknown', () => {
    expect(trashSizeText({ count: 1, bytes: 990 * KB }, 1)).toBe(' (990 KB)');
    expect(trashSizeText({ count: 19, bytes: 990 * KB }, 1)).toBe(' (at least 990 KB)');
    expect(trashSizeText({ count: 18, bytes: 0 }, 0)).toBe('');
  });
});

describe('Done screen wording', () => {
  it('trash then restore/empty of one item (the live run)', () => {
    expect(doneTitle(990 * KB, 1)).toBe('You freed 990 KB');
    expect(doneLines(1, 990 * KB, 1)).toEqual([
      '1 item moved to Trash. You can get it back for 60 days.',
      'Your Trash is **990 KB** smaller than before. If you emptied it, that space is yours again.',
    ]);
  });
  it('plural wording', () => {
    expect(doneLines(3, 0, 0)[0]).toBe('3 items moved to Trash. You can get them back for 60 days.');
    expect(doneLines(3, 0, 0)[1]).toBe('The space comes back once Trash is emptied (or after 60 days).');
  });
  it('emptied pre-existing Trash of unknown size', () => {
    expect(doneTitle(0, 18)).toBe('Trash emptied!');
    expect(doneLines(0, 0, 18)).toEqual(['Your Trash has **18 items** fewer than before. If you emptied it, that space is yours again.']);
  });
  it('nothing done', () => {
    expect(doneTitle(0, 0)).toBe('All done!');
    expect(doneLines(0, 0, 0)).toEqual(['Nothing removed this time, and that is fine. Come back any time.']);
  });
});
