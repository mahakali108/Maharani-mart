/**
 * Return window math (lib/delivery/return-window.ts): the platform default,
 * the snapshotted deadline, and the inclusive open/closed boundary.
 */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_RETURN_WINDOW_DAYS,
  computeReturnDeadline,
  describeReturnWindow,
  isReturnWindowDays,
  isReturnWindowOpen,
  parseReturnWindowDays,
} from '@/lib/delivery/return-window';

describe('parseReturnWindowDays', () => {
  it('defaults to 7 days', () => {
    expect(DEFAULT_RETURN_WINDOW_DAYS).toBe(7);
    expect(parseReturnWindowDays(undefined)).toBe(7);
    expect(parseReturnWindowDays(null)).toBe(7);
    expect(parseReturnWindowDays('7')).toBe(7);
    expect(parseReturnWindowDays({ days: 7 })).toBe(7);
    expect(parseReturnWindowDays(-1)).toBe(7);
    expect(parseReturnWindowDays(3.5)).toBe(7);
    expect(parseReturnWindowDays(400)).toBe(7);
  });

  it('accepts whole days within 0–365', () => {
    expect(parseReturnWindowDays(0)).toBe(0);
    expect(parseReturnWindowDays(1)).toBe(1);
    expect(parseReturnWindowDays(30)).toBe(30);
    expect(parseReturnWindowDays(365)).toBe(365);
  });

  it('isReturnWindowDays validates precisely', () => {
    expect(isReturnWindowDays(0)).toBe(true);
    expect(isReturnWindowDays(365)).toBe(true);
    expect(isReturnWindowDays(-1)).toBe(false);
    expect(isReturnWindowDays(366)).toBe(false);
    expect(isReturnWindowDays(1.5)).toBe(false);
    expect(isReturnWindowDays('7')).toBe(false);
  });
});

describe('computeReturnDeadline', () => {
  it('adds the window in calendar days to the delivery date', () => {
    expect(computeReturnDeadline('2026-09-01T10:30:00.000Z', 7)).toBe('2026-09-08');
    expect(computeReturnDeadline('2026-09-01T18:45:00.000Z', 0)).toBe('2026-09-01');
    expect(computeReturnDeadline('2026-12-28T09:00:00.000Z', 7)).toBe('2027-01-04'); // crosses year end
    expect(computeReturnDeadline('2026-02-27T09:00:00.000Z', 3)).toBe('2026-03-02'); // crosses month end
  });

  it('falls back to the default for invalid windows', () => {
    expect(computeReturnDeadline('2026-09-01T10:30:00.000Z', 999)).toBe('2026-09-08');
    expect(computeReturnDeadline('2026-09-01T10:30:00.000Z', -5)).toBe('2026-09-08');
  });
});

describe('isReturnWindowOpen', () => {
  it('is open on the deadline day (inclusive)', () => {
    expect(isReturnWindowOpen('2026-09-08', '2026-09-08')).toBe(true);
  });

  it('is open before the deadline', () => {
    expect(isReturnWindowOpen('2026-09-08', '2026-09-05')).toBe(true);
  });

  it('closes the day after the deadline', () => {
    expect(isReturnWindowOpen('2026-09-08', '2026-09-09')).toBe(false);
    expect(isReturnWindowOpen('2026-09-08', '2026-12-31')).toBe(false);
  });

  it('ignores the time-of-day: only the date part matters', () => {
    expect(isReturnWindowOpen('2026-09-08', '2026-09-08T23:59:59.999Z')).toBe(true);
    expect(isReturnWindowOpen('2026-09-08', '2026-09-09T00:00:00.001Z')).toBe(false);
  });
});

describe('describeReturnWindow', () => {
  it('speaks to the retailer', () => {
    expect(describeReturnWindow('2026-09-08', '2026-09-05')).toContain('open until 2026-09-08');
    expect(describeReturnWindow('2026-09-08', '2026-09-09')).toContain('closed on 2026-09-08');
  });
});
