/**
 * Dashboard date-range parsing — Asia/Kolkata calendar days, UTC storage.
 * Invalid input never fabricates a window: it falls back to Today.
 */

import {
  formatIndiaDate,
  indiaAddDaysToKey,
  indiaDayEndIso,
  indiaDayStartIso,
  indiaDiffDays,
  indiaTodayDateKey,
} from '@/lib/datetime/india';
import type { DashboardPreset, DashboardRange } from './types';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const PRESETS: DashboardPreset[] = ['today', '7d', '30d', 'custom'];
/** Inclusive span cap (today + 89 prior days). Matches Command Center sales intel. */
export const DASHBOARD_MAX_WINDOW_DAYS = 90;

export function isDashboardPreset(value: string | undefined): value is DashboardPreset {
  return value !== undefined && (PRESETS as readonly string[]).includes(value);
}

export function isValidDateKey(value: string | undefined): value is string {
  if (!value || !DATE_RE.test(value)) return false;
  return indiaDayStartIso(value) !== null;
}

function labelFor(preset: DashboardPreset, fromKey: string, toKey: string): string {
  if (preset === 'today') return 'Today';
  if (preset === '7d') return 'Last 7 days';
  if (preset === '30d') return 'Last 30 days';
  if (fromKey === toKey) return formatIndiaDate(fromKey);
  return `${formatIndiaDate(fromKey)} — ${formatIndiaDate(toKey)}`;
}

function bounds(fromKey: string, toKey: string): Pick<DashboardRange, 'fromIso' | 'toIso' | 'previousFromKey' | 'previousToKey' | 'previousFromIso' | 'previousToIso' | 'spanDays'> {
  const spanDays = Math.max(1, (indiaDiffDays(fromKey, toKey) ?? 0) + 1);
  const previousToKey = indiaAddDaysToKey(fromKey, -1) ?? fromKey;
  const previousFromKey = indiaAddDaysToKey(previousToKey, -(spanDays - 1)) ?? previousToKey;
  return {
    fromIso: indiaDayStartIso(fromKey) ?? `${fromKey}T00:00:00.000Z`,
    toIso: indiaDayEndIso(toKey) ?? `${toKey}T23:59:59.999Z`,
    previousFromKey,
    previousToKey,
    previousFromIso: indiaDayStartIso(previousFromKey) ?? `${previousFromKey}T00:00:00.000Z`,
    previousToIso: indiaDayEndIso(previousToKey) ?? `${previousToKey}T23:59:59.999Z`,
    spanDays,
  };
}

export function parseDashboardRange(
  params: { range?: string; from?: string; to?: string },
  now: Date | number = new Date()
): DashboardRange {
  const todayKey = indiaTodayDateKey(now);
  const requested = isDashboardPreset(params.range) ? params.range : 'today';
  let error: string | null = null;
  let truncatedWindow = false;
  let preset: DashboardPreset = requested;
  let fromKey = todayKey;
  let toKey = todayKey;

  if (requested === '7d') {
    fromKey = indiaAddDaysToKey(todayKey, -6) ?? todayKey;
  } else if (requested === '30d') {
    fromKey = indiaAddDaysToKey(todayKey, -29) ?? todayKey;
  } else if (requested === 'custom') {
    const rawFrom = params.from;
    const rawTo = params.to;
    if (!isValidDateKey(rawFrom) || !isValidDateKey(rawTo)) {
      error = 'Custom range needs two valid dates (YYYY-MM-DD). Showing today instead.';
      preset = 'today';
      fromKey = todayKey;
      toKey = todayKey;
    } else {
      fromKey = rawFrom;
      toKey = rawTo;
      if (fromKey > toKey) {
        const swap = fromKey;
        fromKey = toKey;
        toKey = swap;
      }
      if (toKey > todayKey) toKey = todayKey;
      if (fromKey > todayKey) fromKey = todayKey;
      const span = (indiaDiffDays(fromKey, toKey) ?? 0) + 1;
      if (span > DASHBOARD_MAX_WINDOW_DAYS) {
        fromKey = indiaAddDaysToKey(toKey, -(DASHBOARD_MAX_WINDOW_DAYS - 1)) ?? fromKey;
        truncatedWindow = true;
      }
    }
  }

  return {
    preset,
    fromKey,
    toKey,
    label: labelFor(preset, fromKey, toKey),
    truncatedWindow,
    error,
    ...bounds(fromKey, toKey),
  };
}

export function dashboardRangeHref(preset: DashboardPreset, fromKey?: string, toKey?: string): string {
  if (preset === 'custom' && fromKey && toKey) {
    return `/admin/dashboard?range=custom&from=${fromKey}&to=${toKey}`;
  }
  return `/admin/dashboard?range=${preset}`;
}
