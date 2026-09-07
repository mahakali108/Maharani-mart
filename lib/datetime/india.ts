/**
 * Single display-layer date/time formatter for Maharani Mart.
 *
 * Database timestamps stay in UTC. Every user-facing clock is converted with
 * `Intl.DateTimeFormat` and `timeZone: "Asia/Kolkata"` so SSR, browsers and
 * Android Capacitor/WebView all show the same IST values — never the server
 * local zone, never the device zone, never a hardcoded +05:30 offset.
 *
 * Required India format:
 *   Date  DD MMM YYYY
 *   Time  hh:mm AM/PM
 *   Both  04 Sep 2026, 07:18 PM
 */

export const INDIA_TIME_ZONE = 'Asia/Kolkata';

export type TimestampInput = string | number | Date | null | undefined;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Cached formatter — timezone conversion is DST-safe via IANA Asia/Kolkata. */
const IST_PARTS = new Intl.DateTimeFormat('en-US', {
  timeZone: INDIA_TIME_ZONE,
  year: 'numeric',
  month: 'numeric',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: true,
});

export interface IndiaDateParts {
  year: string;
  month: string;
  day: string;
  hour: string;
  minute: string;
  dayPeriod: 'AM' | 'PM';
  date: string;
  time: string;
  dateTime: string;
  calendarKey: string;
}

function pad2(value: string | number): string {
  return String(value).padStart(2, '0');
}

function monthName(monthNumber: string | number): string | null {
  const index = Number(monthNumber) - 1;
  return MONTHS[index] ?? null;
}

function normalizeDayPeriod(value: string | undefined): 'AM' | 'PM' {
  const compact = (value ?? '').replace(/\./g, '').replace(/\s/g, '').toUpperCase();
  if (compact.startsWith('P')) return 'PM';
  return 'AM';
}

/**
 * Parse a stored timestamp without assuming the host timezone.
 * - Date-only `YYYY-MM-DD` is a calendar date (no time).
 * - Naive `YYYY-MM-DD HH:mm[:ss]` (no zone) is treated as UTC, matching
 *   Postgres timestamptz values that were stored in UTC.
 */
export function parseTimestamp(value: TimestampInput): Date | null {
  if (value == null || value === '') return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  if (typeof value !== 'string') return null;

  const trimmed = value.trim();
  if (!trimmed) return null;
  if (DATE_ONLY.test(trimmed)) return null;

  let candidate = trimmed;
  if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}/.test(candidate) && !/(?:[zZ]|[+-]\d{2}:?\d{2})$/.test(candidate)) {
    candidate = `${candidate.replace(' ', 'T')}Z`;
  }

  const date = new Date(candidate);
  return Number.isNaN(date.getTime()) ? null : date;
}

function dateOnlyParts(value: string): IndiaDateParts | null {
  const match = DATE_ONLY.exec(value.trim());
  if (!match) return null;
  const year = match[1]!;
  const monthNum = match[2]!;
  const day = match[3]!;
  const month = monthName(monthNum);
  if (!month) return null;
  const date = `${day} ${month} ${year}`;
  return {
    year,
    month: monthNum,
    day,
    hour: '12',
    minute: '00',
    dayPeriod: 'AM',
    date,
    time: '12:00 AM',
    dateTime: date,
    calendarKey: `${year}-${monthNum}-${day}`,
  };
}

export function indiaDateParts(value: TimestampInput): IndiaDateParts | null {
  if (typeof value === 'string' && DATE_ONLY.test(value.trim())) {
    return dateOnlyParts(value);
  }

  const date = parseTimestamp(value);
  if (!date) return null;

  const bag: Partial<Record<Intl.DateTimeFormatPartTypes, string>> = {};
  for (const part of IST_PARTS.formatToParts(date)) {
    if (part.type !== 'literal') bag[part.type] = part.value;
  }

  const year = bag.year;
  const monthNum = bag.month;
  const dayRaw = bag.day;
  const hourRaw = bag.hour;
  const minuteRaw = bag.minute;
  if (!year || !monthNum || !dayRaw || !hourRaw || !minuteRaw) return null;

  const month = monthName(monthNum);
  if (!month) return null;

  const day = pad2(dayRaw);
  const hour = pad2(hourRaw);
  const minute = pad2(minuteRaw);
  const dayPeriod = normalizeDayPeriod(bag.dayPeriod);
  const dateLabel = `${day} ${month} ${year}`;
  const timeLabel = `${hour}:${minute} ${dayPeriod}`;

  return {
    year,
    month: pad2(monthNum),
    day,
    hour,
    minute,
    dayPeriod,
    date: dateLabel,
    time: timeLabel,
    dateTime: `${dateLabel}, ${timeLabel}`,
    calendarKey: `${year}-${pad2(monthNum)}-${day}`,
  };
}

export function formatIndiaDate(value: TimestampInput, fallback = '—'): string {
  return indiaDateParts(value)?.date ?? fallback;
}

export function formatIndiaTime(value: TimestampInput, fallback = '—'): string {
  if (typeof value === 'string' && DATE_ONLY.test(value.trim())) {
    return fallback;
  }
  return indiaDateParts(value)?.time ?? fallback;
}

export function formatIndiaDateTime(value: TimestampInput, fallback = '—'): string {
  const parts = indiaDateParts(value);
  if (!parts) return fallback;
  if (typeof value === 'string' && DATE_ONLY.test(value.trim())) return parts.date;
  return parts.dateTime;
}

/** Asia/Kolkata calendar date as `YYYY-MM-DD`. */
export function indiaCalendarDateKey(value: TimestampInput = new Date()): string | null {
  return indiaDateParts(value)?.calendarKey ?? null;
}

export function indiaTodayDateKey(now: Date | number = new Date()): string {
  return indiaCalendarDateKey(now) ?? '1970-01-01';
}

function calendarKeyToUtcDay(key: string): number | null {
  const match = DATE_ONLY.exec(key);
  if (!match) return null;
  return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) / 86_400_000;
}

/**
 * Relative calendar label using the Asia/Kolkata date, not UTC or the host TZ.
 * Returns "Today", "Yesterday", or `DD MMM YYYY`.
 */
export function formatIndiaRelativeDate(
  value: TimestampInput,
  options?: { now?: Date | number; fallback?: string }
): string {
  const fallback = options?.fallback ?? '—';
  const parts = indiaDateParts(value);
  if (!parts) return fallback;

  const nowKey = indiaCalendarDateKey(options?.now ?? new Date());
  if (!nowKey) return parts.date;

  const valueDay = calendarKeyToUtcDay(parts.calendarKey);
  const nowDay = calendarKeyToUtcDay(nowKey);
  if (valueDay == null || nowDay == null) return parts.date;

  const delta = nowDay - valueDay;
  if (delta === 0) return 'Today';
  if (delta === 1) return 'Yesterday';
  return parts.date;
}

/**
 * Relative datetime: "Today, 07:18 PM" / "Yesterday, 07:18 PM" / "04 Sep 2026, 07:18 PM".
 */
export function formatIndiaRelativeDateTime(
  value: TimestampInput,
  options?: { now?: Date | number; fallback?: string }
): string {
  const fallback = options?.fallback ?? '—';
  if (typeof value === 'string' && DATE_ONLY.test(value.trim())) {
    return formatIndiaRelativeDate(value, options);
  }

  const parts = indiaDateParts(value);
  if (!parts) return fallback;

  const relative = formatIndiaRelativeDate(value, options);
  if (relative === 'Today' || relative === 'Yesterday') {
    return `${relative}, ${parts.time}`;
  }
  return parts.dateTime;
}
