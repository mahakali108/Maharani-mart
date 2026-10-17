import { keysetCursorFor, readCursor, toListBatch, type KeysetColumn } from './keyset';
import type { ListCursor } from './cursor';

/**
 * Iterate a complete keyset-ordered result using bounded database pages.
 *
 * `fetchPage` should return at most `pageSize + 1` rows with `applyCursor` and
 * the same `columns` ordering. The extra row is only a continuation probe;
 * each item is yielded once and the caller can stream it without retaining the
 * full export in memory.
 */
export async function* iterateKeysetPages<T extends object>(
  fetchPage: (cursor: ListCursor | null) => Promise<T[]>,
  columns: KeysetColumn[],
  pageSize: number
): AsyncGenerator<T> {
  const size = Number.isFinite(pageSize) ? Math.max(1, Math.trunc(pageSize)) : 1;
  const seenCursors = new Set<string>();
  let cursor: ListCursor | null = null;

  while (true) {
    const rows = await fetchPage(cursor);
    const batch = toListBatch(rows, size, (row) => keysetCursorFor(row, columns));
    let nextCursor: ListCursor | null = null;

    if (batch.nextCursor !== null) {
      if (seenCursors.has(batch.nextCursor)) {
        throw new Error('Keyset pagination did not advance while preparing the export.');
      }
      const next = readCursor(batch.nextCursor);
      if (!next || next.k !== 'keyset') {
        throw new Error('Could not continue keyset pagination while preparing the export.');
      }
      seenCursors.add(batch.nextCursor);
      nextCursor = next;
    }

    for (const row of batch.items) yield row;
    if (batch.nextCursor === null) return;
    cursor = nextCursor;
  }
}

/** Collecting variant for callers that explicitly need an in-memory array. */
export async function collectKeysetPages<T extends object>(
  fetchPage: (cursor: ListCursor | null) => Promise<T[]>,
  columns: KeysetColumn[],
  pageSize: number
): Promise<T[]> {
  const collected: T[] = [];
  for await (const row of iterateKeysetPages(fetchPage, columns, pageSize)) {
    collected.push(row);
  }
  return collected;
}
