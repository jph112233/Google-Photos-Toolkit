import { describe, it, expect } from 'vitest';
import { formatBytes, formatBytesRange, formatDuration, formatCount, plural, formatEta } from '../src/cleanup/format';

const GB = 1024 ** 3;
const MB = 1024 ** 2;

describe('formatBytes', () => {
  it('handles zero, negative and junk', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(-5)).toBe('0 B');
    expect(formatBytes(undefined)).toBe('0 B');
    expect(formatBytes(NaN)).toBe('0 B');
  });
  it('formats each unit', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(820 * 1024)).toBe('820 KB');
    expect(formatBytes(312 * MB)).toBe('312 MB');
    expect(formatBytes(41.3 * GB)).toBe('41.3 GB');
    expect(formatBytes(2 * 1024 * GB)).toBe('2 TB');
  });
  it('keeps one decimal under 100 and drops trailing .0', () => {
    expect(formatBytes(1.04 * GB)).toBe('1 GB');
    expect(formatBytes(9.95 * MB)).toBe('9.9 MB');
    expect(formatBytes(187.4 * GB)).toBe('187 GB');
  });
});

describe('formatBytesRange', () => {
  it('shares the unit when both ends match', () => {
    expect(formatBytesRange(60 * GB, 90 * GB)).toBe('60-90 GB');
  });
  it('keeps both units when they differ', () => {
    expect(formatBytesRange(700 * MB, 1.5 * GB)).toBe('700 MB-1.5 GB');
  });
  it('collapses identical ends', () => {
    expect(formatBytesRange(GB, GB)).toBe('1 GB');
  });
});

describe('formatDuration', () => {
  it('formats minutes and hours', () => {
    expect(formatDuration(102_000)).toBe('1:42');
    expect(formatDuration(5_000)).toBe('0:05');
    expect(formatDuration(3_723_000)).toBe('1:02:03');
  });
  it('handles missing values', () => {
    expect(formatDuration(undefined)).toBe('0:00');
    expect(formatDuration(0)).toBe('0:00');
  });
});

describe('formatCount / plural / formatEta', () => {
  it('groups thousands', () => {
    expect(formatCount(41200)).toBe('41,200');
  });
  it('pluralizes', () => {
    expect(plural(1, 'video')).toBe('1 video');
    expect(plural(128, 'video')).toBe('128 videos');
    expect(plural(2, 'item', 'items')).toBe('2 items');
  });
  it('gives friendly ETAs', () => {
    expect(formatEta(0)).toBe('almost done');
    expect(formatEta(20_000)).toBe('less than a minute left');
    expect(formatEta(60_000)).toBe('about 1 minute left');
    expect(formatEta(4 * 60_000)).toBe('about 4 minutes left');
  });
});
