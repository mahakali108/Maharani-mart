/**
 * Banner targeting + scheduling.
 *
 * Only real navigation targets: rooted app routes or HTTP(S) URLs. Shared by
 * admin validation and the storefront; script URLs are never allowed.
 *
 * Scheduling is interpreted in INDIA time, because the admin form collects a
 * plain calendar date (`YYYY-MM-DD`) while the database stores `timestamptz`:
 *
 *   - a START date begins at 00:00 IST of that day,
 *   - an END date covers the WHOLE day (ends 23:59:59.999 IST),
 *
 * so "ends 30 Sep" still shows the banner on 30 September instead of hiding it
 * at 05:30 that morning. Rows written before this rule (a bare midnight-UTC
 * timestamp, which is what `new Date('YYYY-MM-DD')` produced) are read with the
 * same inclusive meaning, so no existing banner has to be rewritten.
 */

export function resolveBannerTarget(value: string | null | undefined, siteUrl?: string | null): { href: string; external: boolean } | null {
  const target = value?.trim();
  if (!target || /[\\\u0000-\u001f\u007f]/.test(target)) return null;
  if (target.startsWith('/') && !target.startsWith('//')) return { href: target, external: false };
  try {
    const url = new URL(target);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return null;
    if (siteUrl && url.origin === new URL(siteUrl).origin) {
      return { href: `${url.pathname}${url.search}${url.hash}`, external: false };
    }
    return { href: url.href, external: true };
  } catch {
    return null;
  }
}

/** India Standard Time offset — never a hardcoded clock, only for date-only math. */
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** `YYYY-MM-DD`, or an ISO timestamp that is exactly midnight UTC (legacy date-only storage). */
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const LEGACY_DATE_ONLY = /^\d{4}-\d{2}-\d{2}T00:00:00(\.000)?Z$/;

function isDateOnly(value: string): boolean {
  const trimmed = value.trim();
  return DATE_ONLY.test(trimmed) || LEGACY_DATE_ONLY.test(trimmed);
}

export interface BannerSchedule {
  startsAt: string | null;
  endsAt: string | null;
}

/**
 * Turn the admin form's date inputs into exact instants.
 * A start date begins at 00:00 IST; an end date runs until the end of that IST
 * day. Blank/unparseable values become `null` (no bound).
 */
export function bannerScheduleInstants(startsAt: string | null | undefined, endsAt: string | null | undefined): BannerSchedule {
  return {
    startsAt: boundedInstant(startsAt, 'start'),
    endsAt: boundedInstant(endsAt, 'end'),
  };
}

function boundedInstant(value: string | null | undefined, edge: 'start' | 'end'): string | null {
  const trimmed = (value ?? '').trim();
  if (!trimmed) return null;
  const parsed = Date.parse(trimmed);
  if (!Number.isFinite(parsed)) return null;
  if (!isDateOnly(trimmed)) return new Date(parsed).toISOString();
  // The date is read as an IST calendar date: subtract the offset to get the
  // true instant of 00:00 IST, then a whole day minus a millisecond for an END
  // date so the last day is fully covered.
  const dayStart = parsed - IST_OFFSET_MS;
  const instant = edge === 'start' ? dayStart : dayStart + DAY_MS - 1;
  return new Date(instant).toISOString();
}

/** When a stored bound becomes effective / stops being effective (epoch ms). */
function boundInstant(value: string, edge: 'start' | 'end'): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return NaN;
  if (!isDateOnly(value)) return parsed;
  const dayStart = parsed - IST_OFFSET_MS;
  return edge === 'start' ? dayStart : dayStart + DAY_MS - 1;
}

export interface ScheduledBanner {
  is_active: boolean;
  area_id: string | null;
  starts_at: string | null;
  ends_at: string | null;
}

export function isBannerVisible(banner: ScheduledBanner, areaId: string | null, now: number): boolean {
  // An unparseable bound hides the banner instead of guessing a window.
  const started = banner.starts_at ? boundInstant(banner.starts_at, 'start') : -Infinity;
  const ends = banner.ends_at ? boundInstant(banner.ends_at, 'end') : Infinity;
  if (Number.isNaN(started) || Number.isNaN(ends)) return false;
  const inWindow = started <= now && ends >= now;
  return banner.is_active && (!banner.area_id || banner.area_id === areaId) && inWindow;
}

/** Banner artwork standard: 1080 × 360 px, a 3:1 ratio. */
export const BANNER_STANDARD = {
  width: 1080,
  height: 360,
  aspectRatio: '3 / 1',
  guidance: 'Use a 1080 × 360 px image (3:1). Other sizes are cropped to fit — never stretched.',
} as const;
