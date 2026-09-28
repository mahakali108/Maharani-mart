/**
 * Opaque cursors for every infinite-scrolling list in the app.
 *
 * Every list page in the app used to render `?page=N` + "Page 1 of 12" +
 * Previous/Next. Those links are gone: a list now renders its first batch
 * server-side and hands the client an opaque cursor that only the server can
 * interpret. Nothing about the underlying query shape (offset, keyset, column
 * names) is exposed to the browser, so a cursor can never be forged into a
 * different query.
 *
 * Two cursor kinds exist because two loading strategies exist:
 *
 *  - `keyset` — the preferred strategy. The list is ordered by a non-null
 *    column plus a unique tiebreaker (usually `id`), so the next batch is
 *    "everything strictly after the row I just showed". Cost is independent of
 *    how far the user has scrolled, and rows inserted at the top while the user
 *    scrolls cannot shift or repeat what is already on screen.
 *
 *  - `offset` — used when the ORDER BY cannot be compared with a keyset
 *    predicate: a composite sort (new launches first, then name) or a nullable
 *    sort column (batch expiry dates). The offset is still opaque and still
 *    server-side, and the ORDER BY always ends in a unique tiebreaker so the
 *    order is deterministic and pages never overlap.
 *
 * PURE — no Supabase, no `next/*`, no env, no secrets. Covered by
 * tests/infinite-scroll.test.ts.
 */

/** A keyset cursor: the sort values of the last row already shown. */
export interface KeysetCursor {
  k: 'keyset';
  v: KeysetValue[];
}

/** An offset cursor: how many rows deep the list already is. */
export interface OffsetCursor {
  k: 'offset';
  o: number;
}

export type ListCursor = KeysetCursor | OffsetCursor;

/**
 * A sort value captured from the last row shown. Booleans are allowed because
 * some lists sort on a flag first (new launches before the rest) and a keyset
 * cursor has to be able to carry that flag forward.
 */
export type KeysetValue = string | number | boolean | null;

/** A cursors is only ever a short, URL-safe token; anything longer is junk. */
const MAX_CURSOR_LENGTH = 512;

function toBase64Url(value: string): string {
  let binary = '';
  for (const byte of new TextEncoder().encode(value)) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(value: string): string {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(padded.padEnd(Math.ceil(padded.length / 4) * 4, '='));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new TextDecoder().decode(bytes);
}

/** Encode a cursor into the opaque string handed to the browser. */
export function encodeCursor(cursor: ListCursor): string {
  return toBase64Url(JSON.stringify(cursor));
}

/**
 * Decode an untrusted cursor. Anything malformed, oversized, or of an unknown
 * kind becomes `null`, which every loader treats as "start at the beginning".
 */
export function decodeCursor(raw: string | null | undefined): ListCursor | null {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > MAX_CURSOR_LENGTH) return null;
  try {
    const parsed: unknown = JSON.parse(fromBase64Url(raw));
    if (parsed === null || typeof parsed !== 'object') return null;
    const candidate = parsed as Partial<ListCursor>;
    if (candidate.k === 'offset') {
      // `JSON.stringify(NaN)` is `null`, and a string offset could smuggle
      // something odd through — only a real, finite, non-negative number is
      // accepted, everything else starts the list again from the top.
      const offset = candidate.o;
      if (typeof offset !== 'number' || !Number.isFinite(offset) || offset < 0) return null;
      return { k: 'offset', o: Math.min(Math.trunc(offset), 1_000_000) };
    }
    if (candidate.k === 'keyset') {
      if (!Array.isArray(candidate.v) || candidate.v.length === 0 || candidate.v.length > 8) return null;
      // Every KeysetValue the encoder can emit must survive this decode.
      // Booleans are emitted by `is_new_launch`-led orderings (the catalog's
      // default "recommended" sort), and rejecting them silently turned every
      // continuation cursor back into `null` — which every loader reads as
      // "start at the beginning", so the list re-served its first batch
      // forever instead of advancing. Only truly unusable members (null,
      // objects, arrays) invalidate the cursor.
      const values = candidate.v.map((value) =>
        typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
          ? value
          : null
      );
      if (values.some((value) => value === null)) return null;
      return { k: 'keyset', v: values as (string | number | boolean)[] };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Did a loader make progress?
 *
 * A loader that hands back the very cursor it was given cannot continue: asking
 * again would re-request the same rows forever, which is exactly the
 * "permanently stuck at Loading more products…" state (the scroll sentinel
 * stays on screen, so the observer keeps firing). A terminal batch
 * (`nextCursor === null`) always counts as progress, and so does the first
 * batch loaded from `null`.
 *
 * PURE — covered by tests/infinite-scroll.test.ts.
 */
export function isCursorAdvancing(previous: string | null, next: string | null): boolean {
  if (next === null || previous === null) return true;
  return next !== previous;
}

/** One page of a list plus the cursor that fetches the page after it. */
export interface ListBatch<T> {
  items: T[];
  /** `null` means the list is complete — the UI shows its end-of-list state. */
  nextCursor: string | null;
}

/**
 * Split an over-fetched result into "the batch to render" and "is there more".
 *
 * Loaders always ask for `limit + 1` rows: the extra row is the probe that says
 * whether another batch exists, so no list ever needs an expensive
 * `count: 'exact'` just to decide whether to keep scrolling.
 */
export function toListBatch<T>(rows: T[], limit: number, cursorFor: (row: T) => string | null): ListBatch<T> {
  const size = Math.max(1, Math.trunc(limit));
  if (!Array.isArray(rows) || rows.length <= size) {
    return { items: Array.isArray(rows) ? rows : [], nextCursor: null };
  }
  const items = rows.slice(0, size);
  const last = items[items.length - 1];
  if (last === undefined) return { items, nextCursor: null };
  const nextCursor = cursorFor(last);
  // A row the cursor cannot describe (a NULL sort value) ends the list instead
  // of restarting from the top and repeating rows already on screen.
  if (nextCursor === null) return { items: rows, nextCursor: null };
  return { items, nextCursor };
}

/** Build the cursor that continues an offset-ordered list. */
export function offsetCursorFor(offset: number, rendered: number): string | null {
  if (!Number.isFinite(offset) || !Number.isFinite(rendered) || rendered <= 0) return null;
  return encodeCursor({ k: 'offset', o: Math.max(0, Math.trunc(offset) + Math.trunc(rendered)) });
}

/**
 * Split an over-fetched OFFSET query into "the batch to render" + "is there
 * more". Used where the ORDER BY cannot be compared with a keyset predicate
 * (a nullable sort column, or a composite sort); the ORDER BY always ends in a
 * unique tiebreaker so consecutive batches never overlap.
 */
export function toOffsetBatch<T>(rows: T[], limit: number, offset: number): ListBatch<T> {
  const size = Math.max(1, Math.trunc(limit));
  if (!Array.isArray(rows) || rows.length <= size) return { items: Array.isArray(rows) ? rows : [], nextCursor: null };
  return { items: rows.slice(0, size), nextCursor: offsetCursorFor(offset, size) };
}

/** Offset a decoded cursor is positioned at — 0 when there is no cursor. */
export function cursorOffset(cursor: ListCursor | null): number {
  return cursor && cursor.k === 'offset' ? cursor.o : 0;
}
