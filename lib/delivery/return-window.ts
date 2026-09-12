/**
 * Return window math. Pure.
 *
 * The platform sets `orders.return_window_days` in platform_settings
 * (default 7, key 'orders.return_window_days'). At delivery completion the
 * value is SNAPSHOTTED onto order_deliveries (return_window_days +
 * return_deadline) so later setting changes never move the goalpost for
 * already-completed deliveries.
 *
 * The deadline is inclusive: a retailer may request a return ON the deadline
 * date. After that, requestReturnAction rejects with a clear message.
 *
 * Dates are calendar days (YYYY-MM-DD) in the business timezone sense —
 * simple date arithmetic on the ISO date part.
 */

export const DEFAULT_RETURN_WINDOW_DAYS = 7;

export function isReturnWindowDays(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 365;
}

/** Parse a platform_settings-ish jsonb value into a valid window, with default. */
export function parseReturnWindowDays(value: unknown): number {
  if (isReturnWindowDays(value)) return value;
  return DEFAULT_RETURN_WINDOW_DAYS;
}

/** Deadline date (YYYY-MM-DD) = delivered date + windowDays (inclusive). */
export function computeReturnDeadline(deliveredAtIso: string, windowDays: number): string {
  const days = isReturnWindowDays(windowDays) ? windowDays : DEFAULT_RETURN_WINDOW_DAYS;
  const base = new Date(`${deliveredAtIso.slice(0, 10)}T00:00:00Z`);
  const deadline = new Date(base.getTime() + days * 24 * 60 * 60 * 1000);
  return deadline.toISOString().slice(0, 10);
}

/** Is a return still allowed for a deadline, as of `todayIso` (default: now)? */
export function isReturnWindowOpen(deadlineIso: string, todayIso?: string): boolean {
  const today = (todayIso ?? new Date().toISOString()).slice(0, 10);
  return today <= deadlineIso;
}

export function describeReturnWindow(deadlineIso: string, todayIso?: string): string {
  const today = (todayIso ?? new Date().toISOString()).slice(0, 10);
  if (today > deadlineIso) return `Return window closed on ${deadlineIso}.`;
  return `Return window open until ${deadlineIso} (inclusive).`;
}
