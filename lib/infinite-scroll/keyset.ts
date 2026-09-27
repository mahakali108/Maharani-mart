/**
 * Keyset (a.k.a. "seek") pagination helpers for PostgREST/Supabase queries.
 *
 * A keyset cursor is the list of ORDER BY values of the last row already shown.
 * For an ordering of `created_at DESC, id DESC` the predicate for "everything
 * after value (t0, i0)" is
 *
 *     created_at < t0 OR (created_at = t0 AND id < i0)
 *
 * which PostgREST expresses as
 *
 *     or=(created_at.lt."t0",and(created_at.eq."t0",id.lt."i0"))
 *
 * Nested `and(...)` inside `or=(...)` is documented PostgREST syntax
 * (https://docs.postgrest.org/en/v12/references/api/tables_views.html#logical-operators).
 *
 * Compared with `OFFSET`, the database seeks straight to the cursor with the
 * index instead of walking and discarding every skipped row, and — the part
 * users actually notice — a row inserted while they are scrolling cannot make
 * the next batch repeat or skip a row.
 *
 * PURE — builds filter strings only; no Supabase import, no I/O.
 * Covered by tests/infinite-scroll.test.ts.
 */

import { decodeCursor, encodeCursor, type KeysetValue, type ListCursor } from './cursor';

/**
 * Re-exported so a list page only needs this one import: build the query with
 * the helpers below, then hand `toListBatch` the over-fetched rows.
 */
export { toListBatch, toOffsetBatch, offsetCursorFor, cursorOffset } from './cursor';
export type { KeysetValue } from './cursor';

/** One ORDER BY term. Mirrors exactly what the query must be ordered by. */
export interface KeysetColumn {
  column: string;
  ascending: boolean;
}

/** Minimal shape of a PostgREST builder, so this module stays dependency-free. */
export interface OrderableQuery<T> {
  order: (column: string, options?: { ascending?: boolean }) => T;
}

export interface CursorQuery<T> extends OrderableQuery<T> {
  or: (expression: string) => T;
  limit: (count: number) => T;
  range: (from: number, to: number) => T;
}

/**
 * Quote a value for PostgREST. Reserved characters must be quoted, so the
 * value is wrapped in double quotes; booleans are compared as `true`/`false`
 * literals, which is how PostgREST renders a boolean column.
 */
function literal(value: KeysetValue): string {
  if (typeof value === 'boolean') return value ? '"true"' : '"false"';
  const raw = String(value);
  // Double quotes and backslashes are the only characters that could break out
  // of a PostgREST quoted literal; dropping them keeps the predicate a literal.
  return `"${raw.replace(/["\\]/g, '').slice(0, 200)}"`;
}

/**
 * Build the "rows strictly after the cursor" predicate, or `null` when the
 * cursor cannot be compared (wrong shape, or a NULL sort value).
 */
export function buildKeysetPredicate(
  columns: KeysetColumn[],
  values: readonly KeysetValue[]
): string | null {
  if (columns.length === 0 || columns.length !== values.length) return null;

  const branches: string[] = [];
  for (let index = 0; index < columns.length; index += 1) {
    const current = columns[index];
    const value = values[index];
    if (!current || value === null || value === undefined) return null;
    const equality: string[] = [];
    for (let previous = 0; previous < index; previous += 1) {
      const before = columns[previous];
      const beforeValue = values[previous];
      if (!before || beforeValue === null || beforeValue === undefined) return null;
      equality.push(`${before.column}.eq.${literal(beforeValue)}`);
    }
    const strict = current.ascending ? 'gt' : 'lt';
    equality.push(`${current.column}.${strict}.${literal(value)}`);
    branches.push(equality.length === 1 ? (equality[0] ?? '') : `and(${equality.join(',')})`);
  }

  return branches.join(',');
}

/** Order a query by exactly the columns a keyset cursor is built from. */
export function applyKeysetOrder<T extends OrderableQuery<T>>(query: T, columns: KeysetColumn[]): T {
  let next = query;
  for (const column of columns) {
    next = next.order(column.column, { ascending: column.ascending });
  }
  return next;
}

/**
 * Constrain an already-ordered query to the batch after `cursor`.
 *
 * Always requests `limit + 1` rows: the extra row is the probe that tells the
 * client whether another batch exists. Keyset is used whenever the cursor and
 * the ORDER BY agree; an offset cursor falls back to `.range()`.
 */
export function applyCursor<T extends CursorQuery<T>>(
  query: T,
  cursor: ListCursor | null,
  columns: KeysetColumn[],
  limit: number
): T {
  const size = Math.max(1, Math.trunc(limit));
  if (!cursor) return query.limit(size + 1);

  if (cursor.k === 'keyset') {
    const predicate = buildKeysetPredicate(columns, cursor.v);
    if (predicate) return query.or(predicate).limit(size + 1);
    // Un-comparable cursor: return nothing rather than restarting from the top
    // and re-rendering rows the shopper has already scrolled past.
    return query.limit(0);
  }

  const from = Math.max(0, Math.trunc(cursor.o));
  return query.range(from, from + size);
}

/** Cursor for the row that was last rendered, for a list ordered by `columns`. */
export function keysetCursorFor(row: object, columns: KeysetColumn[]): string | null {
  const source = row as Record<string, unknown>;
  const values = columns.map((column) => {
    const value = source?.[column.column];
    return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
      ? value
      : null;
  });
  if (values.some((value) => value === null)) return null;
  return encodeCursor({ k: 'keyset', v: values });
}

/** Decode the cursor the browser sent back, tolerating junk. */
export function readCursor(raw: string | null | undefined): ListCursor | null {
  return decodeCursor(raw);
}

/**
 * Rows the client should never see twice.
 *
 * Keyset/offset batches are already disjoint, but a list can still contain a
 * row twice if two batches straddle an ordering change. Deduping by id keeps
 * the rendered list stable and costs nothing.
 */
export function dedupeById<T>(rows: T[], seen: Set<string>, idOf: (row: T) => string | null): T[] {
  const unique: T[] = [];
  for (const row of rows) {
    const id = idOf(row);
    if (id !== null && seen.has(id)) continue;
    if (id !== null) seen.add(id);
    unique.push(row);
  }
  return unique;
}
