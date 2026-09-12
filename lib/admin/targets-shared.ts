/**
 * Pure target/commission domain helpers shared by admin actions and pages.
 * No DB access — everything here is unit-testable (tests/staff-targets.test.ts).
 */

export const TARGET_METRICS = [
  { value: 'sales_value', label: 'Sales value (₹)' },
  { value: 'collection_value', label: 'Collection value (₹)' },
  { value: 'order_count', label: 'Orders collected' },
  { value: 'visit_count', label: 'Visits logged' },
  { value: 'new_retailers', label: 'New retailers approved' },
] as const;

export type TargetMetric = (typeof TARGET_METRICS)[number]['value'];

export function isTargetMetric(value: unknown): value is TargetMetric {
  return typeof value === 'string' && TARGET_METRICS.some((m) => m.value === value);
}

export const TARGET_PERIOD_TYPES = ['month', 'quarter'] as const;
export type TargetPeriodType = (typeof TARGET_PERIOD_TYPES)[number];

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export interface TargetPeriod {
  start: string;
  end: string;
}

function toDateKey(value: string): number {
  return Date.parse(`${value}T00:00:00Z`);
}

const DAY_MS = 86_400_000;

function daysBetween(from: string, to: string): number {
  return Math.round((toDateKey(to) - toDateKey(from)) / DAY_MS);
}

/**
 * Resolves the calendar month containing `anchor` (an ISO date key).
 * Pure string math — no timezone dependencies.
 */
export function resolveMonthPeriod(anchor: string): TargetPeriod | null {
  if (!DATE_RE.test(anchor)) return null;
  const [y, m] = anchor.split('-').map(Number);
  if (!y || !m || m < 1 || m > 12) return null;
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const mm = String(m).padStart(2, '0');
  return { start: `${y}-${mm}-01`, end: `${y}-${mm}-${String(lastDay).padStart(2, '0')}` };
}

/** Resolves the calendar quarter containing `anchor` (Jan–Mar, Apr–Jun, …). */
export function resolveQuarterPeriod(anchor: string): TargetPeriod | null {
  if (!DATE_RE.test(anchor)) return null;
  const [y, m] = anchor.split('-').map(Number);
  if (!y || !m || m < 1 || m > 12) return null;
  const q = Math.floor((m - 1) / 3);
  const startMonth = q * 3 + 1;
  const endMonth = startMonth + 2;
  const lastDay = new Date(Date.UTC(y, endMonth, 0)).getUTCDate();
  return {
    start: `${y}-${String(startMonth).padStart(2, '0')}-01`,
    end: `${y}-${String(endMonth).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`,
  };
}

/**
 * Validates an explicit period: real dates, end >= start, and a span that
 * genuinely looks like a month (28–31 days) or a quarter (89–92 days) so a
 * typo cannot silently create a 3-day "quarter".
 */
export function validateTargetPeriod(
  periodType: TargetPeriodType,
  start: string,
  end: string
): { ok: true; period: TargetPeriod } | { ok: false; error: string } {
  if (!DATE_RE.test(start) || !DATE_RE.test(end)) {
    return { ok: false, error: 'Enter valid start and end dates (YYYY-MM-DD).' };
  }
  if (Number.isNaN(toDateKey(start)) || Number.isNaN(toDateKey(end))) {
    return { ok: false, error: 'Enter valid start and end dates (YYYY-MM-DD).' };
  }
  const days = daysBetween(start, end);
  if (days < 0) return { ok: false, error: 'The period end cannot be before the start.' };
  const spanOk =
    periodType === 'month' ? days >= 27 && days <= 31 : days >= 88 && days <= 92;
  if (!spanOk) {
    return {
      ok: false,
      error:
        periodType === 'month'
          ? 'A month period must span 28–31 days.'
          : 'A quarter period must span about 90 days.',
    };
  }
  return { ok: true, period: { start, end } };
}

/** Percentage of target achieved (>= 0, may exceed 100 — bars clamp visually); null when target is 0. */
export function targetAttainmentPercent(actual: number, target: number): number | null {
  if (target <= 0) return null;
  return Math.max(0, Math.round((actual / target) * 100));
}

// ---------------------------------------------------------------------------
// Commissions
// ---------------------------------------------------------------------------

export const COMMISSION_BASES = [
  { value: 'sales_value', label: 'Sales value (₹)' },
  { value: 'collection_value', label: 'Collection value (₹)' },
] as const;

export type CommissionBasis = (typeof COMMISSION_BASES)[number]['value'];

export type CommissionStatus = 'draft' | 'approved' | 'paid';

/**
 * Commission math in integer paise — the same money discipline as the wallet
 * ledger (lib/retailer/wallet.ts). Rupees in, paise out, never a float sum.
 */
export function computeCommissionPaise(basisAmountRupees: number, ratePercent: number): number {
  if (!Number.isFinite(basisAmountRupees) || basisAmountRupees < 0) return 0;
  if (!Number.isFinite(ratePercent) || ratePercent < 0 || ratePercent > 100) return 0;
  return Math.round(basisAmountRupees * 100 * (ratePercent / 100));
}

/**
 * Sales basis for a period from the real order rows already fetched under
 * RLS: every non-cancelled, non-returned order collected by the user counts.
 * `grandTotal` is rupees.
 */
export function summarizeSalesBasis(
  orders: { grand_total: number; status: string }[]
): number {
  return orders
    .filter((o) => o.status !== 'cancelled' && o.status !== 'returned')
    .reduce((sum, o) => sum + Math.max(0, Number(o.grand_total) || 0), 0);
}

/** Valid transition guard for the commission lifecycle draft → approved → paid. */
export function nextCommissionStatus(current: CommissionStatus): CommissionStatus | null {
  if (current === 'draft') return 'approved';
  if (current === 'approved') return 'paid';
  return null;
}
