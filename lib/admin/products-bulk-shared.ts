/**
 * Pure bulk-catalog types and bounds shared by the server action, the bulk
 * toolbar and the tests.
 *
 * Kept OUT of the 'use server' module because Next.js only allows async
 * function exports from server-action files — a `export const` there fails the
 * production build with "Only async functions are allowed to be exported in a
 * 'use server' file". Same convention as lib/retailer/bulk-shared.ts and
 * lib/admin/targets-shared.ts.
 */

/** Hard ceiling on one bulk operation, so a select-all cannot become a DoS. */
export const MAX_BULK_IDS = 200;

/** Upper bound on the id list accepted by the export route. */
export const MAX_EXPORT_IDS = 500;

export interface BulkSkip {
  id: string;
  name: string;
  reason: string;
}

export type BulkResult =
  | { ok: true; message: string; updated: number; skipped: BulkSkip[] }
  | { ok: false; error: string };

export type BulkActionKind =
  | 'activate'
  | 'deactivate'
  | 'category'
  | 'brand'
  | 'gst'
  | 'moq'
  | 'price';

/** A UUID-shaped guard for ids that arrive from client checkboxes. */
export function isIdShape(value: string): boolean {
  return /^[0-9a-f-]{36}$/i.test(value);
}

/**
 * Normalise the `productIds` checkbox values from a bulk form.
 *
 * The ids come from the DOM, so they are untrusted: de-duplicated, checked for
 * shape and bounded. A malformed id is a hard error rather than a silent
 * drop — a bulk write that quietly skipped a row the operator had selected
 * would be worse than one that refuses.
 */
export function normalizeBulkIds(raw: unknown[]): { ids: string[] } | { error: string } {
  const values = raw.map((value) => String(value).trim()).filter(Boolean);
  const ids = [...new Set(values)];
  if (ids.length === 0) return { error: 'Select at least one product first.' };
  if (ids.length > MAX_BULK_IDS) {
    return { error: `A bulk action can cover at most ${MAX_BULK_IDS} products at a time.` };
  }
  if (!ids.every(isIdShape)) {
    return { error: 'The selection contained an invalid product reference. Reload and try again.' };
  }
  return { ids };
}
