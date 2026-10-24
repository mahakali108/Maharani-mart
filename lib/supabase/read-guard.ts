/**
 * Distinguishing "this record does not exist" from "the read failed".
 *
 * Supabase returns `{ data: null, error: null }` for a missing row and
 * `{ data: null, error: {...} }` for a failed read. A detail page that only
 * destructures `data` therefore treats a schema drift (42703), an RLS denial,
 * a timeout or an expired session exactly like a deleted record and calls
 * `notFound()` — showing the customer "this page could not be found" and the
 * operator "this order/banner/product was deleted", which is a false statement
 * about their data.
 *
 * Correct handling:
 *   - `error` set            → throw, so the route's `error.tsx` boundary shows
 *                              a retryable failure (this helper);
 *   - no error, no row       → `notFound()` is the truthful answer.
 *
 * Server-only in practice (it is used by RSC pages), but pure and free of
 * imports so it can be unit-tested without a Supabase client.
 */

/** The shape both `maybeSingle()` and `single()` put in `error`. */
export interface PostgrestReadError {
  message: string;
  code?: string;
  details?: string | null;
  hint?: string | null;
}

/**
 * Throw a descriptive Error when a read failed.
 *
 * `what` is a short human label ("Order", "Banner", "Seller account") used as
 * the message prefix; the database message is appended so the error boundary
 * (and the server log) carries the real cause instead of a generic string.
 *
 * Deliberately does NOT swallow or rewrite the database message: the message
 * is what makes a 42703 (unknown column) immediately obvious to an engineer.
 * It contains no customer data — PostgREST errors describe the query, not rows.
 */
export function throwIfReadFailed(
  error: PostgrestReadError | null | undefined,
  what: string
): void {
  if (!error) return;
  const code = error.code ? ` [${error.code}]` : '';
  throw new Error(`${what} could not be loaded${code}: ${error.message}`);
}

/** Convenience boolean for callers that render rather than throw. */
export function readFailed(error: PostgrestReadError | null | undefined): boolean {
  return Boolean(error);
}
