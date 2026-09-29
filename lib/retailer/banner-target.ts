/**
 * Banner targeting + scheduling.
 *
 * Only real navigation targets: rooted app routes or HTTP(S) URLs. Shared by
 * admin validation and the storefront; script URLs are never allowed.
 *
 * Scheduling is interpreted in INDIA time. New Admin forms collect explicit
 * local date-times (`datetime-local`) and the database stores `timestamptz`;
 * legacy date-only values keep their inclusive IST-day meaning so existing
 * banners remain visible without rewriting stored rows.
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

/** India Standard Time offset, used only to interpret admin wall-clock values. */
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** `YYYY-MM-DD`, or an ISO timestamp that is exactly midnight UTC (legacy date-only storage). */
const DATE_ONLY = /^(\d{4}-\d{2}-\d{2})$/;
const LEGACY_DATE_ONLY = /^(\d{4}-\d{2}-\d{2})T00:00:00(?:\.000)?Z$/;
const LOCAL_DATE_TIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/;

function isDateOnly(value: string): boolean {
  const trimmed = value.trim();
  return DATE_ONLY.test(trimmed) || LEGACY_DATE_ONLY.test(trimmed);
}

/** Convert an Admin `datetime-local` wall-clock value to a UTC instant in IST. */
function localDateTimeInstant(value: string): number | null {
  const match = LOCAL_DATE_TIME.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6] ?? 0);
  const millisecond = Number((match[7] ?? '').padEnd(3, '0') || 0);
  const asUtc = Date.UTC(year, month - 1, day, hour, minute, second, millisecond);
  const check = new Date(asUtc);
  if (
    check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day ||
    hour > 23 || minute > 59 || second > 59
  ) return null;
  return asUtc - IST_OFFSET_MS;
}

/** Format a stored timestamp for an IST `datetime-local` field. */
export function toBannerDateTimeLocal(value: string | null | undefined, edge: 'start' | 'end'): string {
  const trimmed = (value ?? '').trim();
  const dateOnly = DATE_ONLY.exec(trimmed) ?? LEGACY_DATE_ONLY.exec(trimmed);
  if (dateOnly?.[1]) return `${dateOnly[1]}T${edge === 'start' ? '00:00' : '23:59'}`;
  const parsed = Date.parse(trimmed);
  if (!Number.isFinite(parsed)) return '';
  const ist = new Date(parsed + IST_OFFSET_MS);
  const pad = (number: number) => String(number).padStart(2, '0');
  return `${ist.getUTCFullYear()}-${pad(ist.getUTCMonth() + 1)}-${pad(ist.getUTCDate())}T${pad(ist.getUTCHours())}:${pad(ist.getUTCMinutes())}`;
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
  if (LOCAL_DATE_TIME.test(trimmed)) {
    const localInstant = localDateTimeInstant(trimmed);
    return localInstant === null ? null : new Date(localInstant).toISOString();
  }
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
