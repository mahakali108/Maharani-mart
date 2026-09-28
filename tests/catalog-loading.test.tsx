// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import {
  InfiniteScrollProvider,
  InfiniteScrollRows,
  InfiniteScrollStatus,
} from '@/components/ui/infinite-scroll';
import {
  applyKeysetOrder,
  buildKeysetPredicate,
  keysetCursorFor,
  readContinuation,
  readCursor,
  toListBatch,
  type KeysetColumn,
} from '@/lib/infinite-scroll/keyset';
import { encodeCursor, type KeysetCursor, type ListCursor } from '@/lib/infinite-scroll/cursor';

/**
 * REGRESSION SUITE — "retailer catalog stuck on Loading more products…".
 *
 * Root cause: the catalog's DEFAULT sort (`recommended`) orders by
 * `is_new_launch DESC, name ASC, id ASC`, so its keyset cursor carries a
 * BOOLEAN. `encodeCursor`/`keysetCursorFor` emitted that boolean (the
 * `KeysetValue` type documents booleans), but `decodeCursor` mapped every
 * non-string/non-number member to `null` and then rejected the whole cursor.
 * Every continuation therefore decoded to `null`, which loaders read as
 * "start at the beginning": batch #1 was served again, forever, each time with
 * a fresh next cursor, so the list never advanced and the spinner never
 * stopped.
 *
 * These tests pin every layer of the fix:
 *   1. a boolean-led cursor round-trips and still builds a keyset predicate,
 *   2. keyset paging walks the whole catalog exactly once (no repeats/gaps),
 *   3. an undecodable continuation cursor terminates instead of replaying,
 *   4. the client list stops when a loader repeats its cursor,
 *   5. rapid scroll never overlaps requests, the last page stops the spinner,
 *      an empty batch terminates the list and a failure offers Retry.
 */

/** Narrow a decoded cursor to its keyset form (every catalog cursor is one). */
function decodeAsKeyset(cursor: ListCursor | null): KeysetCursor {
  if (!cursor || cursor.k !== 'keyset') throw new Error('expected a keyset cursor');
  return cursor;
}

const RECOMMENDED_ORDER: KeysetColumn[] = [
  { column: 'is_new_launch', ascending: false },
  { column: 'name', ascending: true },
  { column: 'id', ascending: true },
];

interface SimProduct extends Record<string, unknown> {
  id: string;
  name: string;
  is_new_launch: boolean;
}

/** Evaluate one PostgREST term (`col.op."value"`) against a row. */
function evalTerm(term: string, row: SimProduct): boolean {
  const match = term.match(/^([a-z_]+)\.(eq|gt|lt)\.(.*)$/);
  if (!match) throw new Error(`Unparsable predicate term: ${term}`);
  const [, column, operator, rawValue] = match;
  const literal = (rawValue ?? '').replace(/^"|"$/g, '');
  const actual = row[column as keyof SimProduct];
  const expected: string | number | boolean =
    typeof actual === 'boolean' ? literal === 'true' : typeof actual === 'number' ? Number(literal) : literal;
  if (operator === 'eq') return actual === expected;
  if (operator === 'gt') return actual! > expected;
  return actual! < expected;
}

/** Split a PostgREST `or=(...)` body into top-level branches. */
function splitTopLevel(expression: string): string[] {
  const branches: string[] = [];
  let depth = 0;
  let current = '';
  for (const character of expression) {
    if (character === '(') depth += 1;
    if (character === ')') depth -= 1;
    if (character === ',' && depth === 0) {
      branches.push(current);
      current = '';
      continue;
    }
    current += character;
  }
  if (current) branches.push(current);
  return branches;
}

/** Evaluate the predicate `buildKeysetPredicate` produced, OR of branches. */
function matchesPredicate(predicate: string, row: SimProduct): boolean {
  return splitTopLevel(predicate).some((branch) => {
    const inner = branch.startsWith('and(') ? branch.slice(4, -1) : branch;
    return splitTopLevel(inner).every((term) => evalTerm(term, row));
  });
}

function compareRows(a: SimProduct, b: SimProduct, columns: KeysetColumn[]): number {
  for (const column of columns) {
    const left = a[column.column as keyof SimProduct];
    const right = b[column.column as keyof SimProduct];
    if (left === right) continue;
    const result = left! > right! ? 1 : -1;
    return column.ascending ? result : -result;
  }
  return 0;
}

/** The catalog's DB-paginated mode, reduced to its database contract. */
function nextBatch(rows: SimProduct[], cursorRaw: string | null, pageSize: number) {
  const continuation = readContinuation(cursorRaw);
  if (!continuation.ok) return { items: [] as SimProduct[], nextCursor: null, terminated: true };
  const ordered = [...rows].sort((a, b) => compareRows(a, b, RECOMMENDED_ORDER));
  const predicate =
    continuation.cursor && continuation.cursor.k === 'keyset'
      ? buildKeysetPredicate(RECOMMENDED_ORDER, continuation.cursor.v)
      : null;
  const filtered = predicate ? ordered.filter((row) => matchesPredicate(predicate, row)) : ordered;
  const overFetched = filtered.slice(0, pageSize + 1);
  const batch = toListBatch(overFetched, pageSize, (row) => keysetCursorFor(row, RECOMMENDED_ORDER));
  return { ...batch, terminated: false };
}

const CATALOG: SimProduct[] = Array.from({ length: 50 }, (_, index) => ({
  id: `p${String(index + 1).padStart(2, '0')}`,
  name: `Product ${String(index + 1).padStart(2, '0')}`,
  // A healthy mix: new launches sort first, so a cursor must carry `true` too.
  is_new_launch: index % 3 === 0,
}));

describe('catalog keyset cursor (default "recommended" sort)', () => {
  it('round-trips the boolean-led cursor the catalog actually emits', () => {
    const lastRowOfBatch = CATALOG[23]!;
    const raw = keysetCursorFor(lastRowOfBatch, RECOMMENDED_ORDER);
    expect(raw).not.toBeNull();

    const decoded = readCursor(raw);
    expect(decoded).not.toBeNull();
    expect(decoded).toMatchObject({ k: 'keyset' });
    // Booleans must survive: without this the cursor is rejected and the list
    // restarts from the top on every scroll.
    expect((decoded as { v: unknown[] }).v[0]).toBe(lastRowOfBatch.is_new_launch);
    expect((decoded as { v: unknown[] }).v.slice(1)).toEqual([lastRowOfBatch.name, lastRowOfBatch.id]);
  });

  it('still builds a usable keyset predicate after decoding', () => {
    const tail = decodeAsKeyset(readCursor(keysetCursorFor({ is_new_launch: false, name: 'Product 24', id: 'p24' }, RECOMMENDED_ORDER)!));
    const tailPredicate = buildKeysetPredicate(RECOMMENDED_ORDER, tail.v)!;
    // Everything strictly after a non-launch row: the (empty) true-branch, the
    // later names among non-launches, and the id tiebreaker for equal names.
    expect(tailPredicate).toContain('is_new_launch.lt."false"');
    expect(tailPredicate).toContain('and(is_new_launch.eq."false",name.gt."Product 24")');
    expect(tailPredicate).toContain('and(is_new_launch.eq."false",name.eq."Product 24",id.gt."p24")');

    // A launch row keeps the boolean branch that used to be dropped entirely.
    const launch = decodeAsKeyset(
      readCursor(keysetCursorFor({ is_new_launch: true, name: 'Product 3', id: 'p03' }, RECOMMENDED_ORDER)!)
    );
    expect(buildKeysetPredicate(RECOMMENDED_ORDER, launch.v)).toContain('is_new_launch.lt."true"');
  });

  it('walks the entire catalog exactly once and stops on the last page', () => {
    const seen: string[] = [];
    let cursor: string | null = null;
    let batches = 0;
    let lastBatchSize = -1;
    for (;;) {
      const batch = nextBatch(CATALOG, cursor, 24);
      batches += 1;
      seen.push(...batch.items.map((row) => row.id));
      lastBatchSize = batch.items.length;
      if (!batch.nextCursor) break;
      cursor = batch.nextCursor;
      if (batches > 10) throw new Error('pagination did not terminate');
    }

    expect(batches).toBe(3);
    expect(lastBatchSize).toBe(2);
    expect(new Set(seen).size).toBe(CATALOG.length);
    expect(seen).toEqual([...CATALOG].sort((a, b) => compareRows(a, b, RECOMMENDED_ORDER)).map((row) => row.id));
  });

  it('treats an undecodable continuation cursor as the end of the list, never a restart', () => {
    expect(readContinuation(null)).toEqual({ ok: true, cursor: null });
    expect(readContinuation('').ok).toBe(true);
    expect(readContinuation('not-a-cursor').ok).toBe(false);
    // A structurally valid cursor with an unusable member is still refused…
    expect(readContinuation(encodeCursor({ k: 'keyset', v: [null as never, 'x', 'y'] })).ok).toBe(false);
    // …but a boolean is a legitimate member.
    const booleanCursor = encodeCursor({ k: 'keyset', v: [false, 'Product 24', 'p24'] });
    const read = readContinuation(booleanCursor);
    expect(read.ok).toBe(true);
    expect(read.ok && read.cursor).toMatchObject({ k: 'keyset', v: [false, 'Product 24', 'p24'] });

    // The loader contract: an unusable cursor yields nothing and ends the list.
    const terminated = nextBatch(CATALOG, 'not-a-cursor', 24);
    expect(terminated.terminated).toBe(true);
    expect(terminated.items).toEqual([]);
    expect(terminated.nextCursor).toBeNull();
  });
});

/* ------------------------------------------------------------------------- */
/* Client state machine                                                       */
/* ------------------------------------------------------------------------- */

type ObserverCallback = (entries: { isIntersecting: boolean }[]) => void;
let observerCallbacks: ObserverCallback[] = [];

class FakeIntersectionObserver {
  constructor(private callback: ObserverCallback) {
    observerCallbacks.push(callback);
  }
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return [];
  }
  readonly root = null;
  readonly rootMargin = '';
  readonly thresholds: readonly number[] = [];
}

function scrollToBottom() {
  const pending = observerCallbacks;
  observerCallbacks = [];
  act(() => {
    for (const callback of pending) callback([{ isIntersecting: true }]);
  });
}

function rowText() {
  return Array.from(document.querySelectorAll('[data-row]')).map((node) => node.textContent);
}

beforeEach(() => {
  observerCallbacks = [];
  vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver);
});

afterEach(() => {
  cleanup();
});

describe('catalog infinite scroll state machine', () => {
  it('stops safely when a loader repeats the cursor it was given', async () => {
    const loader = vi.fn(async (cursor: string | null) => ({
      rows: [<li key={`row-${cursor}`} data-row>{`batch-${cursor}`}</li>],
      nextCursor: 'same-cursor',
    }));

    render(
      <InfiniteScrollProvider loader={loader} initialCursor="same-cursor" initialHasMore>
        <ul>
          <InfiniteScrollRows>
            <li data-row>first</li>
          </InfiniteScrollRows>
        </ul>
        <InfiniteScrollStatus endLabel="No more products" loadingLabel="Loading more products…" />
      </InfiniteScrollProvider>
    );

    scrollToBottom();
    // The repeated cursor must terminate the list: one request, then the end
    // label — never an endless "Loading more products…" spinner.
    await waitFor(() => expect(screen.getByText('No more products')).toBeTruthy());
    expect(loader).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Loading more products…')).toBeNull();
    expect(rowText()).toEqual(['first']);
    expect(screen.queryByText('batch-same-cursor')).toBeNull();
  });

  it('ignores rapid repeat scrolls while a batch is already in flight', async () => {
    let resolveBatch: (() => void) | undefined;
    const loader = vi.fn(
      (cursor: string | null) =>
        new Promise<{ rows: React.ReactNode[]; nextCursor: string | null }>((resolve) => {
          resolveBatch = () => resolve({ rows: [<li key="row-2" data-row>second</li>], nextCursor: null });
          void cursor;
        })
    );

    render(
      <InfiniteScrollProvider loader={loader} initialCursor="c1" initialHasMore>
        <ul>
          <InfiniteScrollRows>
            <li data-row>first</li>
          </InfiniteScrollRows>
        </ul>
        <InfiniteScrollStatus endLabel="No more products" loadingLabel="Loading more products…" />
      </InfiniteScrollProvider>
    );

    scrollToBottom();
    scrollToBottom();
    scrollToBottom();
    await waitFor(() => expect(loader).toHaveBeenCalledTimes(1));
    act(() => resolveBatch?.());
    await waitFor(() => expect(rowText()).toContain('second'));
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it('stops the spinner on the last page and shows the end label', async () => {
    const loader = vi.fn(async () => ({ rows: [<li key="row-2" data-row>second</li>], nextCursor: null }));

    render(
      <InfiniteScrollProvider loader={loader} initialCursor="c1" initialHasMore>
        <ul>
          <InfiniteScrollRows>
            <li data-row>first</li>
          </InfiniteScrollRows>
        </ul>
        <InfiniteScrollStatus endLabel="No more products" loadingLabel="Loading more products…" />
      </InfiniteScrollProvider>
    );

    scrollToBottom();
    await waitFor(() => expect(screen.getByText('No more products')).toBeTruthy());
    expect(screen.queryByText('Loading more products…')).toBeNull();
    expect(rowText()).toEqual(['first', 'second']);
  });

  it('ends the list when a batch comes back empty', async () => {
    const loader = vi.fn(async () => ({ rows: [], nextCursor: 'c2' }));

    render(
      <InfiniteScrollProvider loader={loader} initialCursor="c1" initialHasMore>
        <ul>
          <InfiniteScrollRows>
            <li data-row>first</li>
          </InfiniteScrollRows>
        </ul>
        <InfiniteScrollStatus endLabel="No more products" loadingLabel="Loading more products…" />
      </InfiniteScrollProvider>
    );

    scrollToBottom();
    await waitFor(() => expect(screen.getByText('No more products')).toBeTruthy());
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it('surfaces a failed batch with Retry instead of looping', async () => {
    const loader = vi
      .fn<(cursor: string | null) => Promise<{ rows: React.ReactNode[]; nextCursor: string | null }>>()
      .mockRejectedValueOnce(new Error('Catalog is unavailable right now.'))
      .mockResolvedValueOnce({ rows: [<li key="row-2" data-row>second</li>], nextCursor: null });

    render(
      <InfiniteScrollProvider loader={loader} initialCursor="c1" initialHasMore>
        <ul>
          <InfiniteScrollRows>
            <li data-row>first</li>
          </InfiniteScrollRows>
        </ul>
        <InfiniteScrollStatus endLabel="No more products" loadingLabel="Loading more products…" />
      </InfiniteScrollProvider>
    );

    scrollToBottom();
    const retry = await waitFor(() => screen.getByRole('button', { name: /retry/i }));
    expect(screen.getByText('Catalog is unavailable right now.')).toBeTruthy();

    act(() => {
      retry.click();
    });
    await waitFor(() => expect(rowText()).toContain('second'));
    expect(loader).toHaveBeenCalledTimes(2);
  });
});

describe('catalog order shape', () => {
  it('orders the default sort by the same columns the cursor carries', () => {
    const ordered: { calls: { column: string; ascending?: boolean }[] } = { calls: [] };
    const query = {
      order(column: string, options?: { ascending?: boolean }) {
        ordered.calls.push({ column, ascending: options?.ascending });
        return this;
      },
    };
    applyKeysetOrder(query, RECOMMENDED_ORDER);
    expect(ordered.calls).toEqual([
      { column: 'is_new_launch', ascending: false },
      { column: 'name', ascending: true },
      { column: 'id', ascending: true },
    ]);
  });
});
