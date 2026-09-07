import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const SOURCE_ROOTS = ['app', 'components', 'lib'];
const SHARED_HELPER = 'lib/datetime/india.ts';

function walkSourceFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const rel = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkSourceFiles(rel));
      continue;
    }
    if (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) files.push(rel);
  }
  return files;
}
import {
  INDIA_TIME_ZONE,
  formatIndiaDate,
  formatIndiaDateTime,
  formatIndiaRelativeDate,
  formatIndiaRelativeDateTime,
  formatIndiaTime,
  indiaAddDaysToKey,
  indiaCalendarDateKey,
  indiaDateKeyOffset,
  indiaDateParts,
  indiaDayEndIso,
  indiaDayStartIso,
  indiaDiffDays,
  indiaMonthStart,
  indiaPreviousMonthStart,
  indiaTodayDateKey,
  parseTimestamp,
} from '@/lib/datetime/india';

describe('India (Asia/Kolkata) display formatter', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('exports the IANA zone rather than a fixed offset', () => {
    expect(INDIA_TIME_ZONE).toBe('Asia/Kolkata');
  });

  it('formats the required India example from a UTC instant', () => {
    // 04 Sep 2026, 07:18 PM IST = 04 Sep 2026, 13:48 UTC
    const utc = '2026-09-04T13:48:00.000Z';
    expect(formatIndiaDateTime(utc)).toBe('04 Sep 2026, 07:18 PM');
    expect(formatIndiaDate(utc)).toBe('04 Sep 2026');
    expect(formatIndiaTime(utc)).toBe('07:18 PM');
  });

  it('formats morning IST from a UTC timestamp', () => {
    // 04 Sep 2026, 07:18 AM IST = 04 Sep 2026, 01:48 UTC
    expect(formatIndiaDateTime('2026-09-04T01:48:00.000Z')).toBe('04 Sep 2026, 07:18 AM');
  });

  it('converts UTC midnight to 05:30 AM IST on the same calendar date', () => {
    expect(formatIndiaDateTime('2026-09-04T00:00:00.000Z')).toBe('04 Sep 2026, 05:30 AM');
    expect(formatIndiaDate('2026-09-04T00:00:00.000Z')).toBe('04 Sep 2026');
  });

  it('rolls the calendar date at IST midnight, not UTC midnight', () => {
    // 03 Sep 2026 18:29:00 UTC = 03 Sep 2026, 11:59 PM IST
    expect(formatIndiaDateTime('2026-09-03T18:29:00.000Z')).toBe('03 Sep 2026, 11:59 PM');
    expect(indiaCalendarDateKey('2026-09-03T18:29:00.000Z')).toBe('2026-09-03');

    // 03 Sep 2026 18:30:00 UTC = 04 Sep 2026, 12:00 AM IST
    expect(formatIndiaDateTime('2026-09-03T18:30:00.000Z')).toBe('04 Sep 2026, 12:00 AM');
    expect(indiaCalendarDateKey('2026-09-03T18:30:00.000Z')).toBe('2026-09-04');

    // 04 Sep 2026 18:30:00 UTC = 05 Sep 2026, 12:00 AM IST
    expect(formatIndiaDateTime('2026-09-04T18:30:00.000Z')).toBe('05 Sep 2026, 12:00 AM');
    expect(indiaCalendarDateKey('2026-09-04T18:30:00.000Z')).toBe('2026-09-05');
  });

  it('does not depend on the host timezone for the same UTC instant', () => {
    const utc = '2026-09-04T13:48:00.000Z';
    const previous = process.env.TZ;
    try {
      process.env.TZ = 'UTC';
      expect(formatIndiaDateTime(utc)).toBe('04 Sep 2026, 07:18 PM');
      process.env.TZ = 'America/Los_Angeles';
      expect(formatIndiaDateTime(utc)).toBe('04 Sep 2026, 07:18 PM');
      process.env.TZ = 'Pacific/Kiritimati';
      expect(formatIndiaDateTime(utc)).toBe('04 Sep 2026, 07:18 PM');
    } finally {
      if (previous === undefined) delete process.env.TZ;
      else process.env.TZ = previous;
    }
  });

  it('treats naive SQL timestamps as UTC storage', () => {
    expect(formatIndiaDateTime('2026-09-04 13:48:00')).toBe('04 Sep 2026, 07:18 PM');
    expect(formatIndiaDateTime('2026-09-04T13:48:00')).toBe('04 Sep 2026, 07:18 PM');
  });

  it('formats date-only calendar values without shifting the day', () => {
    expect(formatIndiaDate('2026-09-04')).toBe('04 Sep 2026');
    expect(formatIndiaDateTime('2026-09-04')).toBe('04 Sep 2026');
    expect(indiaCalendarDateKey('2026-09-04')).toBe('2026-09-04');
    expect(formatIndiaTime('2026-09-04')).toBe('—');
  });

  it('returns the fallback for null, empty and invalid values', () => {
    expect(formatIndiaDateTime(null)).toBe('—');
    expect(formatIndiaDateTime(undefined)).toBe('—');
    expect(formatIndiaDateTime('')).toBe('—');
    expect(formatIndiaDateTime('not-a-date')).toBe('—');
    expect(formatIndiaDateTime(Number.NaN)).toBe('—');
    expect(formatIndiaDateTime('nope', 'Unknown')).toBe('Unknown');
    expect(parseTimestamp('garbage')).toBeNull();
    expect(parseTimestamp(null)).toBeNull();
    expect(indiaDateParts('bogus')).toBeNull();
  });

  it('accepts Date objects and unix milliseconds', () => {
    const ms = Date.parse('2026-09-04T13:48:00.000Z');
    expect(formatIndiaDateTime(ms)).toBe('04 Sep 2026, 07:18 PM');
    expect(formatIndiaDateTime(new Date(ms))).toBe('04 Sep 2026, 07:18 PM');
  });

  it('labels Today and Yesterday from the Asia/Kolkata calendar, not UTC', () => {
    // "Now" is 04 Sep 2026 00:30 IST = 03 Sep 2026 19:00 UTC
    const now = new Date('2026-09-03T19:00:00.000Z');

    expect(formatIndiaRelativeDate('2026-09-03T18:45:00.000Z', { now })).toBe('Today');
    expect(formatIndiaRelativeDateTime('2026-09-03T18:45:00.000Z', { now })).toBe('Today, 12:15 AM');

    // 03 Sep 2026 22:00 IST = 03 Sep 2026 16:30 UTC — previous IST day
    expect(formatIndiaRelativeDate('2026-09-03T16:30:00.000Z', { now })).toBe('Yesterday');
    expect(formatIndiaRelativeDateTime('2026-09-03T16:30:00.000Z', { now })).toBe('Yesterday, 10:00 PM');

    // Two IST days earlier is a full date
    expect(formatIndiaRelativeDate('2026-09-02T16:30:00.000Z', { now })).toBe('02 Sep 2026');
    expect(formatIndiaRelativeDateTime('2026-09-02T16:30:00.000Z', { now })).toBe('02 Sep 2026, 10:00 PM');
  });

  it('does not call UTC 23:30 "Today" when IST has already rolled to the next morning', () => {
    // 04 Sep 2026 05:00 IST = 04 Sep 2026 00:00 UTC? Wait 05:00 IST = 23:30 UTC previous day
    // 04 Sep 2026 05:00 IST = 03 Sep 2026 23:30 UTC
    const now = new Date('2026-09-03T23:30:00.000Z');
    expect(indiaCalendarDateKey(now)).toBe('2026-09-04');

    // 03 Sep 2026 23:00 UTC = 04 Sep 2026 04:30 AM IST → Today
    expect(formatIndiaRelativeDate('2026-09-03T23:00:00.000Z', { now })).toBe('Today');

    // 03 Sep 2026 18:00 UTC = 03 Sep 2026 11:30 PM IST → Yesterday (UTC date is still the 3rd)
    expect(formatIndiaRelativeDate('2026-09-03T18:00:00.000Z', { now })).toBe('Yesterday');
    expect(formatIndiaDateTime('2026-09-03T18:00:00.000Z')).toBe('03 Sep 2026, 11:30 PM');
  });

  it('uses the real clock for relative labels when now is omitted', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-04T13:48:00.000Z'));
    expect(formatIndiaRelativeDateTime('2026-09-04T13:48:00.000Z')).toBe('Today, 07:18 PM');
    expect(formatIndiaRelativeDateTime('2026-09-03T13:48:00.000Z')).toBe('Yesterday, 07:18 PM');
  });

  it('formats the same timestamp consistently across helpers', () => {
    const utc = '2026-09-04T13:48:00.000Z';
    const parts = indiaDateParts(utc);
    expect(parts?.dateTime).toBe(formatIndiaDateTime(utc));
    expect(parts?.date).toBe(formatIndiaDate(utc));
    expect(parts?.time).toBe(formatIndiaTime(utc));
    expect(`${parts?.date}, ${parts?.time}`).toBe('04 Sep 2026, 07:18 PM');
  });
});

describe('Asia/Kolkata calendar-day boundaries (UTC storage, IST day buckets)', () => {
  it('day start is 00:00 IST = 18:30 UTC on the previous calendar day', () => {
    // 04 Sep 2026 00:00 IST = 03 Sep 2026 18:30 UTC
    expect(indiaDayStartIso('2026-09-04')).toBe('2026-09-03T18:30:00.000Z');
  });

  it('day end is 23:59:59.999 IST = 18:29:59.999 UTC the same calendar day', () => {
    // 04 Sep 2026 23:59:59.999 IST = 04 Sep 2026 18:29:59.999 UTC
    expect(indiaDayEndIso('2026-09-04')).toBe('2026-09-04T18:29:59.999Z');
  });

  it('start and end of an IST day are exactly one India day apart and bracket midnight', () => {
    const start = new Date(indiaDayStartIso('2026-09-04')!);
    const end = new Date(indiaDayEndIso('2026-09-04')!);
    expect(end.getTime() - start.getTime()).toBe(86_399_999);
    // Both boundaries render to the same India calendar date.
    expect(indiaCalendarDateKey(start)).toBe('2026-09-04');
    expect(indiaCalendarDateKey(end)).toBe('2026-09-04');
    // One ms past day end rolls to the next India day.
    expect(indiaCalendarDateKey(new Date(end.getTime() + 1))).toBe('2026-09-05');
  });

  it('returns null for malformed date keys (no fabricated bounds)', () => {
    expect(indiaDayStartIso('not-a-date')).toBeNull();
    expect(indiaDayEndIso('2026-9-4')).toBeNull();
  });

  it('adds/subtracts India calendar days across month boundaries', () => {
    expect(indiaAddDaysToKey('2026-09-04', 1)).toBe('2026-09-05');
    expect(indiaAddDaysToKey('2026-09-04', -4)).toBe('2026-08-31');
    expect(indiaAddDaysToKey('2026-01-01', -1)).toBe('2025-12-31');
  });

  it('diffDays counts whole India calendar days', () => {
    expect(indiaDiffDays('2026-09-04', '2026-09-04')).toBe(0);
    expect(indiaDiffDays('2026-09-01', '2026-09-04')).toBe(3);
    expect(indiaDiffDays('2026-09-04', '2026-09-01')).toBe(-3);
  });

  it('today key follows IST even when the UTC date is still the previous day', () => {
    // 04 Sep 2026 00:30 IST = 03 Sep 2026 19:00 UTC
    const now = new Date('2026-09-03T19:00:00.000Z');
    expect(indiaTodayDateKey(now)).toBe('2026-09-04');
    expect(indiaDateKeyOffset(now, -1)).toBe('2026-09-03');
  });

  it('month start is the first India calendar day at 00:00 IST', () => {
    // 04 Sep 2026 07:18 PM IST → month start = 01 Sep 2026 00:00 IST = 31 Aug 18:30 UTC
    const now = new Date('2026-09-04T13:48:00.000Z');
    expect(indiaMonthStart(now).toISOString()).toBe('2026-08-31T18:30:00.000Z');
    expect(indiaPreviousMonthStart(now).toISOString()).toBe('2026-07-31T18:30:00.000Z');
  });

  it('month start wraps the year at January', () => {
    // 15 Jan 2026 12:00 IST = 15 Jan 06:30 UTC
    const now = new Date('2026-01-15T06:30:00.000Z');
    expect(indiaMonthStart(now).toISOString()).toBe('2025-12-31T18:30:00.000Z');
    expect(indiaPreviousMonthStart(now).toISOString()).toBe('2025-11-30T18:30:00.000Z');
  });
});

describe('display dates never use the host timezone', () => {
  const files = SOURCE_ROOTS.flatMap(walkSourceFiles);

  it('keeps Date#toLocaleDateString / toLocaleTimeString out of app code', () => {
    const offenders: string[] = [];
    for (const file of files) {
      if (file === SHARED_HELPER) continue;
      const source = readFileSync(file, 'utf8');
      if (source.includes('toLocaleDateString') || source.includes('toLocaleTimeString')) {
        offenders.push(file);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('keeps Intl.DateTimeFormat in the shared India helper', () => {
    const offenders: string[] = [];
    for (const file of files) {
      if (file === SHARED_HELPER) continue;
      const source = readFileSync(file, 'utf8');
      if (source.includes('Intl.DateTimeFormat')) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });
});
