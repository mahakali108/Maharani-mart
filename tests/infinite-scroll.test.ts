import { describe, expect, it } from 'vitest';
import {
  cursorOffset,
  decodeCursor,
  encodeCursor,
  offsetCursorFor,
  toListBatch,
  toOffsetBatch,
  type ListCursor,
} from '@/lib/infinite-scroll/cursor';
import {
  applyCursor,
  applyKeysetOrder,
  buildKeysetPredicate,
  keysetCursorFor,
  readCursor,
  type KeysetColumn,
} from '@/lib/infinite-scroll/keyset';

/** Records how a PostgREST-shaped builder was driven, without any network. */
function fakeQuery() {
  const calls: string[] = [];
  const query = {
    calls,
    or: (expression: string) => {
      calls.push(`or(${expression})`);
      return query;
    },
    limit: (count: number) => {
      calls.push(`limit(${count})`);
      return query;
    },
    range: (from: number, to: number) => {
      calls.push(`range(${from},${to})`);
      return query;
    },
    order: (column: string, options?: { ascending?: boolean }) => {
      calls.push(`order(${column},${options?.ascending ?? true})`);
      return query;
    },
  };
  return query;
}

const ROW = { id: 'p1', name: 'Basmati Rice', created_at: '2026-01-02T10:00:00.000Z' };

describe('list cursors', () => {
  it('encodes both cursor kinds and decodes them back', () => {
    const keyset: ListCursor = { k: 'keyset', v: ['Basmati Rice', 'p1'] };
    const offset: ListCursor = { k: 'offset', o: 48 };
    expect(decodeCursor(encodeCursor(keyset))).toEqual(keyset);
    expect(decodeCursor(encodeCursor(offset))).toEqual(offset);
  });

  it('hides the query shape — a cursor is opaque, not a URL parameter', () => {
    const cursor = encodeCursor({ k: 'keyset', v: ['Basmati Rice', 'p1'] });
    expect(cursor).not.toContain('Basmati');
    expect(cursor).not.toContain('created_at');
    expect(cursor).not.toContain('p1');
  });

  it('rejects anything it cannot trust instead of guessing', () => {
    expect(decodeCursor(null)).toBeNull();
    expect(decodeCursor(undefined)).toBeNull();
    expect(decodeCursor('')).toBeNull();
    expect(decodeCursor('!!!not base64!!!')).toBeNull();
    // Valid base64, junk payload.
    expect(decodeCursor(btoa('{"k":"nope"}'))).toBeNull();
    expect(decodeCursor(encodeCursor({ k: 'offset', o: Number.NaN } as unknown as ListCursor))).toBeNull();
    // An oversized token is refused before it is even parsed.
    expect(decodeCursor('a'.repeat(600))).toBeNull();
    expect(readCursor('garbage')).toBeNull();
  });

  it('clamps an offset cursor so a crafted value cannot request a huge range', () => {
    const decoded = decodeCursor(encodeCursor({ k: 'offset', o: 5_000_000 }));
    expect(cursorOffset(decoded)).toBeLessThanOrEqual(1_000_000);
    expect(cursorOffset(null)).toBe(0);
  });

  it('continues an offset list from where the last batch ended', () => {
    expect(offsetCursorFor(0, 24)).toBe(encodeCursor({ k: 'offset', o: 24 }));
    expect(offsetCursorFor(24, 24)).toBe(encodeCursor({ k: 'offset', o: 48 }));
    // Nothing rendered => nothing to continue.
    expect(offsetCursorFor(24, 0)).toBeNull();
  });
});

describe('batch slicing', () => {
  it('asks for one probe row and hides it from the rendered batch', () => {
    const rows = Array.from({ length: 25 }, (_, index) => ({ id: `p${index}` }));
    const cursorFor = (row: { id: string }) => encodeCursor({ k: 'keyset', v: [row.id] });

    const batch = toListBatch(rows, 24, cursorFor);
    expect(batch.items).toHaveLength(24);
    expect(batch.nextCursor).toBe(encodeCursor({ k: 'keyset', v: ['p23'] }));
  });

  it('ends the list when the probe row is missing', () => {
    const rows = Array.from({ length: 24 }, (_, index) => ({ id: `p${index}` }));
    const batch = toListBatch(rows, 24, (row) => encodeCursor({ k: 'keyset', v: [row.id] }));
    expect(batch.items).toHaveLength(24);
    expect(batch.nextCursor).toBeNull();
  });

  it('ends the list rather than restarting it when a row has no cursor', () => {
    // A NULL sort value cannot be compared, so the honest answer is "stop".
    const rows = Array.from({ length: 25 }, (_, index) => ({ id: `p${index}` }));
    const batch = toListBatch(rows, 24, () => null);
    expect(batch.items).toHaveLength(25);
    expect(batch.nextCursor).toBeNull();
  });

  it('keeps offset batches disjoint', () => {
    const rows = Array.from({ length: 48 }, (_, index) => ({ id: `p${index}` }));
    // Each batch is what the database would return for that window.
    const first = toOffsetBatch(rows.slice(0, 25), 24, 0);
    const second = toOffsetBatch(rows.slice(24), 24, 24);
    expect(first.items).toHaveLength(24);
    expect(second.items).toHaveLength(24);
    expect([...first.items, ...second.items].map((row) => row.id)).toEqual(rows.map((row) => row.id));
    // The second window had no probe row, so the list is complete.
    expect(second.nextCursor).toBeNull();
    expect(first.nextCursor).toBe(encodeCursor({ k: 'offset', o: 24 }));
  });
});

describe('keyset predicates', () => {
  const newestFirst: KeysetColumn[] = [
    { column: 'created_at', ascending: false },
    { column: 'id', ascending: false },
  ];

  it('seeks strictly after the last row shown', () => {
    const predicate = buildKeysetPredicate(newestFirst, ['2026-01-02T10:00:00.000Z', 'p1']);
    expect(predicate).toBe(
      'created_at.lt."2026-01-02T10:00:00.000Z",and(created_at.eq."2026-01-02T10:00:00.000Z",id.lt."p1")'
    );
  });

  it('flips the comparison for an ascending sort', () => {
    const oldestFirst: KeysetColumn[] = [{ column: 'created_at', ascending: true }];
    expect(buildKeysetPredicate(oldestFirst, ['2026-01-02T10:00:00.000Z'])).toBe(
      'created_at.gt."2026-01-02T10:00:00.000Z"'
    );
  });

  it('handles a composite sort (new launches first, then name)', () => {
    const recommended: KeysetColumn[] = [
      { column: 'is_new_launch', ascending: false },
      { column: 'name', ascending: true },
      { column: 'id', ascending: true },
    ];
    const predicate = buildKeysetPredicate(recommended, [true, 'Basmati Rice', 'p1'])!;
    expect(predicate).toContain('is_new_launch.lt."true"');
    expect(predicate).toContain('and(is_new_launch.eq."true",name.gt."Basmati Rice")');
    expect(predicate).toContain('and(is_new_launch.eq."true",name.eq."Basmati Rice",id.gt."p1")');
  });

  it('refuses a cursor the sort cannot compare instead of returning everything', () => {
    // A NULL sort value would silently restart the list and repeat rows.
    expect(buildKeysetPredicate(newestFirst, [null, 'p1'])).toBeNull();
    expect(buildKeysetPredicate(newestFirst, [])).toBeNull();
    expect(buildKeysetPredicate([], ['x'])).toBeNull();
  });

  it('quotes values so a cursor cannot smuggle PostgREST syntax', () => {
    const payload = 'a,b.or(id.neq.x)';
    const predicate = buildKeysetPredicate(newestFirst, [payload, 'p1'])!;
    // Every occurrence of the value is a quoted literal, so its commas and
    // dots cannot open a new filter clause.
    const occurrences = predicate.split(payload).length - 1;
    expect(occurrences).toBeGreaterThan(1);
    expect(predicate.split(`"${payload}"`).length - 1).toBe(occurrences);
    // Quotes and backslashes inside a value are dropped, not escaped blindly.
    expect(buildKeysetPredicate(newestFirst, ['a"b', 'p1'])).toContain('created_at.lt."ab"');
  });

  it('reads the cursor values straight off the last rendered row', () => {
    const cursor = keysetCursorFor(ROW, newestFirst);
    expect(decodeCursor(cursor)).toEqual({
      k: 'keyset',
      v: ['2026-01-02T10:00:00.000Z', 'p1'],
    });
    // A row missing a sort column yields no cursor, which ends the list.
    expect(keysetCursorFor({ id: 'p1' }, newestFirst)).toBeNull();
  });
});

describe('applying a cursor to a query', () => {
  const order: KeysetColumn[] = [
    { column: 'created_at', ascending: false },
    { column: 'id', ascending: false },
  ];

  it('applies the ORDER BY the cursor was built from', () => {
    const query = fakeQuery();
    applyKeysetOrder(query, order);
    expect(query.calls).toEqual(['order(created_at,false)', 'order(id,false)']);
  });

  it('limits the first batch to size + 1 probe rows', () => {
    const query = fakeQuery();
    applyCursor(query, null, order, 20);
    expect(query.calls).toEqual(['limit(21)']);
  });

  it('seeks with a keyset predicate for later batches', () => {
    const query = fakeQuery();
    const cursor = decodeCursor(encodeCursor({ k: 'keyset', v: ['2026-01-02T10:00:00.000Z', 'p1'] }));
    applyCursor(query, cursor, order, 20);
    expect(query.calls).toHaveLength(2);
    expect(query.calls[0]).toContain('or(created_at.lt.');
    expect(query.calls[1]).toBe('limit(21)');
  });

  it('falls back to a bounded range for an offset cursor', () => {
    const query = fakeQuery();
    const cursor = decodeCursor(encodeCursor({ k: 'offset', o: 40 }));
    applyCursor(query, cursor, order, 20);
    expect(query.calls).toEqual(['range(40,60)']);
  });

  it('returns nothing rather than repeating rows for an unusable keyset cursor', () => {
    const query = fakeQuery();
    // A keyset cursor against a list with no keyset columns cannot be honoured.
    applyCursor(query, decodeCursor(encodeCursor({ k: 'keyset', v: ['x'] })), [], 20);
    expect(query.calls).toEqual(['limit(0)']);
  });
});

// ---------------------------------------------------------------------------
// Every list page: scrolls in bounded batches, never renders page-number UI.
// ---------------------------------------------------------------------------

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();

function read(relativePath: string): string {
  return readFileSync(join(root, relativePath), 'utf8');
}

/**
 * Every list page that used to render pagination, plus the ones that simply
 * loaded a whole table into the page. Each now renders its first batch on the
 * server and appends the rest through the shared machinery.
 */
const CONVERTED_LISTS: string[] = [
  'app/admin/orders/page.tsx',
  'app/admin/notifications/page.tsx',
  'app/admin/audit-logs/page.tsx',
  'app/admin/collections/page.tsx',
  'app/admin/delivered/page.tsx',
  'app/admin/inventory/grn/page.tsx',
  'app/admin/inventory/movements/page.tsx',
  'app/admin/inventory/products/page.tsx',
  'app/admin/inventory/batches/page.tsx',
  'app/admin/inventory/reports/page.tsx',
  'app/admin/inventory/ledger/page.tsx',
  'app/admin/catalog/brands/page.tsx',
  'app/admin/catalog/categories/page.tsx',
  'app/admin/products/page.tsx',
  'app/admin/retailers/page.tsx',
  'app/admin/team/page.tsx',
  'app/admin/support/page.tsx',
  'app/admin/visits/page.tsx',
  'app/retailer/orders/page.tsx',
  'app/retailer/support/page.tsx',
  'app/retailer/catalog/page.tsx',
  'app/retailer/brands/[id]/page.tsx',
  'app/retailer/account/ledger/page.tsx',
  'app/retailer/notifications/page.tsx',
  'app/salesman/collections/page.tsx',
  'app/salesman/visits/page.tsx',
  'app/salesman/orders/page.tsx',
  'app/salesman/retailers/page.tsx',
  'app/staff/inventory/ledger/page.tsx',
  'app/staff/inventory/page.tsx',
  'app/staff/orders/page.tsx',
];

/**
 * Files that a page is checked together with:
 *  - a Client Component that OWNS the page's rows (selection state, per-row
 *    actions, dual mobile/desktop layouts) — that is where the scrolling
 *    machinery lives, not in the page;
 *  - a loader module that owns the batch size for the page.
 */
const ADDITIONAL_SOURCES: Record<string, string[]> = {
  'app/admin/inventory/ledger/page.tsx': ['components/inventory/stock-ledger-list.tsx'],
  'app/staff/inventory/ledger/page.tsx': ['components/inventory/stock-ledger-list.tsx'],
  'app/admin/products/page.tsx': ['components/admin/product-bulk-panel.tsx'],
  'app/retailer/catalog/page.tsx': ['components/retailer/compare-grid.tsx'],
  'app/retailer/notifications/page.tsx': ['components/retailer/notification-list.tsx'],
  'app/retailer/account/ledger/page.tsx': ['components/retailer/wallet-ledger-list.tsx'],
  'app/retailer/brands/[id]/page.tsx': ['lib/retailer/brand-detail.ts'],
};

/** The page plus the components and loader modules that back it. */
function sourcesFor(file: string): string {
  return [file, ...(ADDITIONAL_SOURCES[file] ?? [])].map(read).join('\n');
}

describe('every converted list page', () => {
  it.each(CONVERTED_LISTS)('%s loads through the shared infinite-scroll machinery', (file) => {
    const source = sourcesFor(file);
    // Client components own their rows with `useInfiniteList`; server-rendered
    // tables wrap their markup in <InfiniteScrollProvider>.
    const usesSharedMachinery =
      source.includes('InfiniteScrollProvider') || source.includes('useInfiniteList');
    expect(usesSharedMachinery, `${file} must not hand-roll a scrolling list`).toBe(true);
    expect(source.includes('nextCursor'), `${file} must hand the client a cursor`).toBe(true);
  });

  it.each(CONVERTED_LISTS)('%s asks for one bounded batch at a time', (file) => {
    const source = sourcesFor(file);
    // Either a batch size is declared here, or the page delegates to a helper
    // module that batches for it (the catalog and taxonomy loaders).
    const hasBatchSize =
      /BATCH_SIZE|PAGE_SIZE|MAX_ROWS|perBatch|pageSize/.test(source) ||
      /(load|get|read)[A-Z]\w*Batch\(/.test(source);
    expect(hasBatchSize, `${file} must cap how many rows one request returns`).toBe(true);
  });

  it.each(CONVERTED_LISTS)('%s shows no page-number UI', (file) => {
    const source = sourcesFor(file);
    expect(source, file).not.toMatch(/Page \d|Page \{|of \{totalPages|of \{data\.page|\bpage=\$\{/);
    expect(source, file).not.toMatch(/Previous<\/|Next<\/|›\s*Page/);
    expect(source, file).not.toContain('searchParams.page');
    expect(source, file).not.toContain('parseAdminPage');
  });
});
