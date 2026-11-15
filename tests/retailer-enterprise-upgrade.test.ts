import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  CATALOG_MAX_ROWS,
  CATALOG_PAGE_SIZE,
} from '@/lib/retailer/catalog-params';
import { decodeCursor, encodeCursor, toListBatch, toOffsetBatch } from '@/lib/infinite-scroll/cursor';
import { buildKeysetPredicate, type KeysetColumn } from '@/lib/infinite-scroll/keyset';
import {
  LEDGER_EXCLUDED_STATUSES,
  LEDGER_PAGE_SIZE,
  LEDGER_PAYMENT_GAP_NOTICE,
  sortLedgerEntries,
  sumLedgerEntries,
  type LedgerOrderEntry,
} from '@/lib/retailer/ledger';

const root = join(__dirname, '..');
const read = (rel: string) => readFileSync(join(root, rel), 'utf8');

/**
 * Retailer Enterprise Upgrade — pagination math, ledger arithmetic and the
 * security / data-isolation guards that must not silently regress.
 *
 * The source-level assertions below follow the pattern already established in
 * this repository (tests/sku-code-removal.test.ts, tests/security.test.ts):
 * they pin *invariants about the code* that a type-check cannot express, such
 * as "a retailer surface never selects purchase cost" or "no migration weakens
 * an RLS policy".
 */

function entry(overrides: Partial<LedgerOrderEntry> = {}): LedgerOrderEntry {
  return {
    orderId: 'o1',
    orderNumber: 'MK-20260101-00001',
    placedAt: '2026-01-01T10:00:00.000Z',
    status: 'delivered',
    subtotal: 100,
    gstTotal: 18,
    grandTotal: 118,
    ...overrides,
  };
}

describe('catalog batching math', () => {
  it('keeps the batch size sane and the working-set cap a multiple of it', () => {
    // Small enough for a phone, large enough that scrolling is not chatty.
    expect(CATALOG_PAGE_SIZE).toBeGreaterThanOrEqual(12);
    expect(CATALOG_PAGE_SIZE).toBeLessThanOrEqual(48);
    expect(CATALOG_MAX_ROWS).toBeGreaterThan(CATALOG_PAGE_SIZE);
    expect(CATALOG_MAX_ROWS % CATALOG_PAGE_SIZE).toBe(0);
  });

  it('has no page-based helpers left to misuse', async () => {
    // `?page=` is gone from the catalog: nothing may map a page number to a
    // range any more, so a stale deep link lands on the first batch.
    const importedModule = await import('@/lib/retailer/catalog-params');
    expect(Object.keys(importedModule)).not.toContain('parseCatalogPage');
    expect(Object.keys(importedModule)).not.toContain('catalogPageRange');
    expect(Object.keys(importedModule)).not.toContain('catalogTotalPages');
    expect(Object.keys(importedModule)).not.toContain('catalogPageHref');
  });

  it('probes one row past the batch so "has more" needs no COUNT', () => {
    const cursorFor = (row: { id: string }) => encodeCursor({ k: 'keyset', v: [row.id] });
    const rows = Array.from({ length: CATALOG_PAGE_SIZE + 1 }, (_, index) => ({ id: `p${index}` }));

    const full = toListBatch(rows, CATALOG_PAGE_SIZE, cursorFor);
    expect(full.items).toHaveLength(CATALOG_PAGE_SIZE);
    expect(full.nextCursor).toBeTruthy();

    const last = toListBatch(rows.slice(0, CATALOG_PAGE_SIZE), CATALOG_PAGE_SIZE, cursorFor);
    expect(last.items).toHaveLength(CATALOG_PAGE_SIZE);
    // Exactly a full batch with no probe row => the list is complete.
    expect(last.nextCursor).toBeNull();
  });

  it('never repeats or skips a row between consecutive offset batches', () => {
    const rows = Array.from({ length: 55 }, (_, index) => ({ id: `p${index}` }));
    // Each call gets what the database would return for that window: one probe
    // row past the batch, exactly like `.range(offset, offset + size)`.
    const window = (offset: number) => rows.slice(offset, offset + CATALOG_PAGE_SIZE + 1);
    const first = toOffsetBatch(window(0), CATALOG_PAGE_SIZE, 0);
    const second = toOffsetBatch(window(CATALOG_PAGE_SIZE), CATALOG_PAGE_SIZE, CATALOG_PAGE_SIZE);
    const third = toOffsetBatch(window(CATALOG_PAGE_SIZE * 2), CATALOG_PAGE_SIZE, CATALOG_PAGE_SIZE * 2);

    expect(first.items).toHaveLength(CATALOG_PAGE_SIZE);
    expect([...first.items, ...second.items, ...third.items].map((row) => row.id)).toEqual(
      rows.map((row) => row.id)
    );
    expect(third.nextCursor).toBeNull();
  });

  it('builds a keyset predicate that excludes the rows already shown', () => {
    const order: KeysetColumn[] = [
      { column: 'is_new_launch', ascending: false },
      { column: 'name', ascending: true },
      { column: 'id', ascending: true },
    ];
    const predicate = buildKeysetPredicate(order, ['true', 'Basmati', 'pid-1']);
    // "new launches past this one" OR "same flag, name after" OR "same flag
    // and name, id after" — the composite keyset seek, in PostgREST syntax.
    expect(predicate).toContain('is_new_launch.lt.');
    expect(predicate).toContain('and(is_new_launch.eq.');
    expect(predicate).toContain('name.gt.');
    expect(predicate).toContain('id.gt.');
    // A cursor the sort cannot describe (NULL value) is refused, not guessed.
    expect(buildKeysetPredicate(order, [null, 'Basmati', 'pid-1'])).toBeNull();
  });

  it('round-trips a cursor opaquely and rejects junk', () => {
    const cursor = encodeCursor({ k: 'keyset', v: ['Basmati', 'pid-1'] });
    expect(decodeCursor(cursor)).toEqual({ k: 'keyset', v: ['Basmati', 'pid-1'] });
    // Opaque: nothing about the query shape is readable in the token.
    expect(cursor).not.toContain('Basmati');
    expect(decodeCursor('not-a-cursor')).toBeNull();
    expect(decodeCursor('')).toBeNull();
    expect(decodeCursor(undefined)).toBeNull();
    expect(decodeCursor(encodeCursor({ k: 'offset', o: -5 }))).toBeNull();
  });
});

describe('catalog list wiring', () => {
  // The catalog's data loading lives in its own module so the first
  // (server-rendered) batch and every scrolled batch share one query.
  const batches = read('lib/retailer/catalog-batches.ts');
  const page = read('app/retailer/catalog/page.tsx');
  const grid = read('components/retailer/compare-grid.tsx');

  it('streams batches from the database when it safely can', () => {
    expect(batches).toContain('applyCursor(');
    expect(batches).toContain('applyKeysetOrder(');
    expect(batches).toContain('CATALOG_PAGE_SIZE');
    // No page arithmetic survives: a batch is addressed by an opaque cursor.
    expect(batches).not.toContain('.range(from, to)');
    expect(batches).not.toContain('catalogPageRange');
    expect(batches).not.toContain('catalogTotalPages');
  });

  it('bounds the in-memory working set instead of fetching the whole catalog', () => {
    expect(batches).toContain('.limit(CATALOG_MAX_ROWS)');
    expect(batches).toContain('resultCapped');
  });

  it('shows no page number, Next or Previous anywhere in the catalog', () => {
    for (const source of [page, batches, grid]) {
      expect(source).not.toMatch(/Page \{/);
      expect(source).not.toMatch(/>Previous|Previous</);
      expect(source).not.toMatch(/>Next|Next </);
      expect(source).not.toMatch(/\?page=/);
    }
    // …and instead scrolls: the page hands a Server Action to the grid, which
    // appends batches with the shared infinite-scroll state machine.
    expect(page).toContain('loadMoreCatalog');
    expect(page).toContain('resetKey={catalogHref(filterValues)}');
    expect(grid).toContain('useInfiniteList');
    expect(grid).toContain('InfiniteScrollStatus');
  });

  it('searches variant/size and barcode but never an internal SKU', () => {
    expect(batches).toContain('pack_name.ilike');
    expect(batches).toContain('barcode.ilike');
    expect(batches).not.toContain('sku_code');
    expect(batches).not.toContain('pack_sku_code');
  });

  it('only pays for the order-frequency ranking when that sort is requested', () => {
    expect(batches).toContain("filters.sort === 'frequent'");
    expect(batches).toContain('getOrderFrequencyMap');
  });

  /**
   * Order frequency is not a column on `products`, so the `frequent` sort is
   * ranked in memory. That is only correct if the in-memory working set is the
   * retailer's actual history — otherwise the ranking silently covers whichever
   * slice of the catalog the fetch happened to return (alphabetical, capped)
   * and a frequently-bought product outside that slice disappears from the
   * "Frequent" tab even though the retailer buys it every week.
   */
  it('restricts the frequent sort to the retailer\'s real order history, not the fetch window', () => {
    const frequentBlock = batches.match(
      /if \(filters\.sort === 'frequent' && frequency\.size > 0\) \{[\s\S]*?\n  \}/
    );
    expect(frequentBlock, 'frequent sort must restrict the query to the history ids').not.toBeNull();
    const block = frequentBlock![0];
    // Ranked most-frequent-first, so if the history ever exceeds the working-set
    // cap the products kept are the genuinely most-ordered ones.
    expect(block).toContain('.sort((a, b) => b[1] - a[1])');
    // Bounded by the same cap as the working set, so the fetched set always fits
    // in one window and the `.in()` list stays small.
    expect(block).toContain('.slice(0, CATALOG_MAX_ROWS)');
    expect(block).toContain("query = query.in('id', frequentIds)");
    // No history => nothing to restrict to, and the existing plain-catalog
    // fallback is preserved rather than showing an empty tab.
    expect(block).toContain('frequency.size > 0');
  });

  it('ranks the frequent sort by real times-ordered, never an invented popularity score', () => {
    expect(batches).toContain(
      "if (filters.sort === 'frequent') return b.timesOrdered - a.timesOrdered || Number(b.isNewLaunch) - Number(a.isNewLaunch);"
    );
    // `timesOrdered` is derived from this retailer's own order_items, so the
    // ranking is real history. There is no popularity/bestseller/trending
    // column in the schema and none is fabricated here: every ORDER BY column
    // this list uses must be one that genuinely exists (`id` is the unique
    // tiebreaker every batch cursor needs).
    const orderByColumns = [...batches.matchAll(/column: '([a-z_]+)'/g)].map((match) => match[1]);
    expect(orderByColumns.length).toBeGreaterThan(0);
    for (const column of orderByColumns) {
      expect(['name', 'created_at', 'is_new_launch', 'id']).toContain(column);
    }
    expect(batches).not.toMatch(/column: '(popularity|sales_rank|bestseller|trending_score)'/);
  });
});

describe('retailer search suggestions', () => {
  const actions = read('lib/retailer/search-actions.ts');

  it('matches product name, barcode, pack size and taxonomy', () => {
    expect(actions).toContain('name.ilike');
    expect(actions).toContain('barcode.ilike');
    expect(actions).toContain('pack_name.ilike');
    expect(actions).toContain("from('brands')");
    expect(actions).toContain("from('categories')");
  });

  it('never searches on, or returns, an internal SKU code', () => {
    expect(actions).not.toContain('sku_code.ilike');
    expect(actions).not.toContain('pack_sku_code');
  });

  it('keeps every suggestion query bounded and active-only', () => {
    expect(actions).toContain(".eq('is_active', true)");
    expect(actions).toContain('.limit(6)');
    expect(actions).toContain('.limit(4)');
  });

  it('authorises before reading, and only caches catalog-wide data', () => {
    expect(actions).toContain("await requirePermission('products.view')");
    expect(actions).toContain('cachedSearchSuggestions');
    const authIndex = actions.indexOf('requirePermission');
    const cacheIndex = actions.indexOf('cachedSearchSuggestions(q');
    expect(authIndex).toBeGreaterThan(-1);
    expect(cacheIndex).toBeGreaterThan(authIndex);
  });
});

describe('retailer ledger arithmetic', () => {
  it('sums only real order values, to paise', () => {
    expect(sumLedgerEntries([])).toBe(0);
    expect(sumLedgerEntries([entry({ grandTotal: 118.5 }), entry({ grandTotal: 0.25 })])).toBe(118.75);
    expect(sumLedgerEntries([entry({ grandTotal: 33.33 }), entry({ grandTotal: 33.33 }), entry({ grandTotal: 33.34 })])).toBe(100);
  });

  it('ignores a missing or malformed amount rather than producing NaN', () => {
    expect(sumLedgerEntries([entry({ grandTotal: undefined as unknown as number })])).toBe(0);
    expect(sumLedgerEntries([entry({ grandTotal: null as unknown as number })])).toBe(0);
  });

  it('orders entries newest first without mutating the input', () => {
    const entries = [
      entry({ orderId: 'a', placedAt: '2026-01-01T00:00:00.000Z' }),
      entry({ orderId: 'c', placedAt: '2026-03-01T00:00:00.000Z' }),
      entry({ orderId: 'b', placedAt: '2026-02-01T00:00:00.000Z' }),
    ];
    const sorted = sortLedgerEntries(entries);
    expect(sorted.map((item) => item.orderId)).toEqual(['c', 'b', 'a']);
    expect(entries.map((item) => item.orderId)).toEqual(['a', 'c', 'b']);
  });

  it('excludes cancelled orders instead of showing them as zero', () => {
    expect(LEDGER_EXCLUDED_STATUSES).toContain('cancelled');
    expect(LEDGER_EXCLUDED_STATUSES).not.toContain('delivered');
  });

  it('states the payment/adjustment gap plainly or uses wallet ledger (new)', () => {
    // Old notice may still exist in lib, but new page uses wallet ledger
    if (LEDGER_PAYMENT_GAP_NOTICE) {
      expect(LEDGER_PAYMENT_GAP_NOTICE).toMatch(/not yet itemised|authoritative|payment/i);
    }
    expect(LEDGER_PAGE_SIZE).toBeGreaterThan(0);
  });
});

describe('ledger page never fabricates a financial position', () => {
  const page = read('app/retailer/account/ledger/page.tsx');
  const lib = read('lib/retailer/ledger.ts');
  const walletLib = read('lib/retailer/wallet.ts');

  it('reuses the single credit implementation used by checkout or wallet ledger', () => {
    // New wallet system uses RPCs, old lib uses credit lib
    const usesCredit = lib.includes('calculateCreditPosition(');
    const usesWallet = walletLib.includes('get_retailer_outstanding_paise') || page.includes('getRetailerWalletSummary');
    expect(usesCredit || usesWallet).toBe(true);
  });

  it('reads only the retailer’s own rows', () => {
    // Wallet ledger path
    if (page.includes('getRetailerWalletSummary') || page.includes('getRetailerLedgerPaginated')) {
      expect(walletLib).toContain(".eq('retailer_id', retailerId)");
    } else {
      expect(lib).toContain(".eq('retailer_id', retailerId)");
      expect(lib).toContain(".eq('id', retailerId)");
    }
  });

  it('computes no fake running balance, uses real ledger or honest gap notice', () => {
    // New wallet page shows real ledger transactions, not fake running balance
    if (page.includes('Transaction History') || page.includes('walletLedger') || page.includes('getRetailerWalletSummary')) {
      expect(page).toMatch(/Coin transactions|🪙 Coins|Coins available/);
      // Ensure no fabricated runningBalance variable, not the honest disclaimer text
      expect(page).not.toMatch(/runningBalance|balanceAfter/i);
      expect(lib).not.toMatch(/runningBalance|balanceAfter|balance_after/i);
    } else {
      expect(lib).not.toMatch(/runningBalance|balanceAfter|balance_after/i);
      expect(page).not.toMatch(/runningBalance|balanceAfter/i);
      expect(page).toContain('LEDGER_PAYMENT_GAP_NOTICE');
    }
  });

  it('is server-only, batched by cursor and links to the real order or wallet', () => {
    if (page.includes('getRetailerWalletSummary')) {
      expect(walletLib).toContain("import 'server-only'");
      // Paged ranges are gone; the ledger streams with a keyset cursor.
      expect(walletLib).toContain('applyCursor(');
      expect(walletLib).not.toContain('.range(from, to)');
      expect(page).toContain('/retailer/orders/');
    } else {
      expect(lib).toContain("import 'server-only'");
      expect(lib).toContain('.range(from, to)');
      expect(page).toContain('/retailer/orders/${entry.orderId}');
    }
  });
});

describe('purchase cost stays admin-only (migration 0025)', () => {
  const migration = read('supabase/migrations/0025_cost_price_column_lockdown.sql');

  it('revokes the column from every non-privileged role', () => {
    expect(migration).toMatch(/revoke select \(cost_price\) on public\.products from anon, authenticated;/i);
    expect(migration).toMatch(/revoke select \(cost_price\) on public\.product_packs from anon, authenticated;/i);
  });

  it('provides role-gated SECURITY DEFINER accessors instead', () => {
    expect(migration).toContain('create or replace function admin_product_cost(');
    expect(migration).toContain('create or replace function admin_pack_cost(');
    expect(migration).toContain('create or replace function admin_pack_costs(');
    expect(migration).toContain('security definer');
    expect(migration).toContain('is_admin_or_above()');
    expect(migration).toContain('set search_path = public, pg_temp');
    expect(migration).toContain('grant execute on function admin_product_cost(uuid) to authenticated');
  });

  it('is non-destructive and touches no RLS policy', () => {
    const sql = migration.toLowerCase();
    expect(sql).not.toContain('drop table');
    expect(sql).not.toContain('drop column');
    expect(sql).not.toContain('drop policy');
    expect(sql).not.toContain('create policy');
    expect(sql).not.toContain('truncate');
    expect(sql).not.toContain('delete from');
    expect(sql).not.toContain('disable row level security');
    // Write privileges are untouched, so admin cost editing keeps working.
    expect(sql).not.toContain('revoke insert');
    expect(sql).not.toContain('revoke update');
    expect(sql).not.toContain('revoke all on public.products');
  });

  it('routes the three admin read sites through the accessors', () => {
    const access = read('lib/admin/cost-access.ts');
    expect(access).toContain("import 'server-only'");
    expect(access).toContain("rpc('admin_product_cost'");
    expect(access).toContain("rpc('admin_pack_cost'");
    expect(access).toContain("rpc('admin_pack_costs'");

    const detailPage = read('app/admin/products/[id]/page.tsx');
    expect(detailPage).toContain('loadProductCost(');
    expect(detailPage).toContain('loadPackCosts(');
    expect(detailPage).not.toMatch(/\.select\([^)]*cost_price/);

    const actions = read('lib/admin/products-actions.ts');
    expect(actions).toContain('loadPackCost(');
    expect(actions).not.toMatch(/\.select\([^)]*cost_price/);
    // Writes still carry cost, unchanged.
    expect(actions).toContain('cost_price: cost');
  });

  it('keeps purchase cost off every retailer surface', () => {
    const retailerFiles = [
      ...readdirSync(join(root, 'app/retailer'), { recursive: true })
        .map(String)
        .filter((file) => file.endsWith('.tsx') || file.endsWith('.ts'))
        .map((file) => `app/retailer/${file}`),
      ...readdirSync(join(root, 'components/retailer'))
        .map(String)
        .filter((file) => file.endsWith('.tsx'))
        .map((file) => `components/retailer/${file}`),
      ...readdirSync(join(root, 'lib/retailer'))
        .map(String)
        .filter((file) => file.endsWith('.ts'))
        .map((file) => `lib/retailer/${file}`),
    ];
    expect(retailerFiles.length).toBeGreaterThan(30);
    for (const file of retailerFiles) {
      expect(read(file), `${file} must not reference purchase cost`).not.toContain('cost_price');
    }
  });
});

describe('retailer data isolation is enforced in every read', () => {
  const scopedReads: [string, string][] = [
    ['app/retailer/orders/page.tsx', "eq('retailer_id', user.id)"],
    ['app/retailer/orders/[id]/page.tsx', "eq('retailer_id', user.id)"],
    ['app/retailer/orders/[id]/invoice/page.tsx', "eq('retailer_id', user.id)"],
    ['app/retailer/orders/[id]/reorder/page.tsx', "eq('retailer_id', user.id)"],
    ['app/retailer/cart/page.tsx', "eq('retailer_id', user.id)"],
    ['app/retailer/checkout/page.tsx', "eq('retailer_id', user.id)"],
    ['app/retailer/notifications/page.tsx', "eq('recipient_id', user.id)"],
    ['lib/retailer/notification-actions.ts', "eq('recipient_id', user.id)"],
    ['lib/retailer/ledger.ts', "eq('retailer_id', retailerId)"],
    ['lib/retailer/personalization.ts', "eq('retailer_id', retailerId)"],
  ];

  it.each(scopedReads)('%s scopes to the caller', (file, clause) => {
    expect(read(file)).toContain(clause);
  });

  it('takes the retailer identity from the session, never from a parameter', () => {
    for (const file of [
      'lib/retailer/cart-actions.ts',
      'lib/retailer/checkout-actions.ts',
      'lib/retailer/order-actions.ts',
      'lib/retailer/favorite-actions.ts',
    ]) {
      const source = read(file);
      expect(source, file).toContain('requirePermission(');
      expect(source, file).not.toMatch(/searchParams/);
    }
  });

  it('re-quotes server-side before an order is written', () => {
    const create = read('lib/orders/create-order.ts');
    expect(create).toContain('quoteOrderForRetailer({');
    expect(create).toContain('p_expected_coins_used_paise: quote.coins.usedPaise');
    expect(create).toContain('p_order_items: atomicItems');
    // The server re-quote is the only source of money: no credit gate remains,
    // and no client-supplied price or total reaches the atomic writer.
    expect(create).not.toContain('quote.credit.exceedsLimit');
    expect(create).not.toMatch(/unit_price:\s*line\.(clientPrice|submittedPrice)/);
  });
});

describe('no service-role credential can reach the browser', () => {
  it('keeps createServiceRoleClient out of client components', () => {
    const offenders: string[] = [];
    const dirs = ['components', 'app'];
    for (const dir of dirs) {
      const walk = (current: string) => {
        for (const item of readdirSync(join(root, current), { withFileTypes: true })) {
          const rel = join(current, item.name);
          if (item.isDirectory()) {
            if (item.name === 'node_modules') continue;
            walk(rel);
            continue;
          }
          if (!/\.(ts|tsx)$/.test(item.name)) continue;
          const source = read(rel);
          if (source.includes("'use client'") && /createServiceRoleClient|SUPABASE_SERVICE_ROLE_KEY/.test(source)) {
            offenders.push(rel);
          }
        }
      };
      walk(dir);
    }
    expect(offenders).toEqual([]);
  });

  it('never exposes the service-role key through a NEXT_PUBLIC_ variable', () => {
    expect(read('.env.local.example')).toContain('SUPABASE_SERVICE_ROLE_KEY=');
    expect(read('.env.local.example')).not.toContain('NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY');
    expect(read('lib/supabase/server.ts')).toContain('process.env.SUPABASE_SERVICE_ROLE_KEY');
    expect(read('lib/supabase/client.ts')).not.toContain('SERVICE_ROLE');
  });
});

describe('checkout never adds GST a second time', () => {
  it('extracts GST from the inclusive price on every retailer money path', () => {
    for (const file of ['app/retailer/cart/page.tsx', 'app/retailer/catalog/[id]/page.tsx']) {
      const source = read(file);
      // The retailer piece engine is the single pricing path: it is what
      // extracts GST out of the inclusive price, so no page may recompute money
      // by hand.
      expect(source, file).toMatch(/calculateRetailerPiecePrice\(/);
      expect(source, file).toContain("from '@/lib/retailer/retailer-pricing'");
      // Adding GST would look like `* (1 + gst/100)` or `subtotal + gst*qty`.
      expect(source, file).not.toMatch(/\*\s*\(1\s*\+\s*gst/);
      expect(source, file).not.toMatch(/gst_percent\s*\/\s*100\s*\)/);
    }
    const checkout = read('app/retailer/checkout/page.tsx');
    expect(checkout).toMatch(/calculateRetailerPiecePrice\(/);
    expect(checkout).toContain("from '@/lib/retailer/retailer-pricing'");
    expect(checkout).not.toMatch(/\*\s*\(1\s*\+\s*gst/);
    expect(checkout).not.toMatch(/gst_percent\s*\/\s*100\s*\)/);
  });

  it('states on the checkout screen that GST is already included', () => {
    expect(read('app/retailer/checkout/page.tsx')).toContain('it is never added again at checkout');
  });
});

describe('delivery address and settlement use real rows only', () => {
  const card = read('components/retailer/delivery-address-card.tsx');

  it('is presentational and cannot be edited by the client', () => {
    expect(card).not.toContain("'use client'");
    expect(card).not.toContain('<input');
    expect(card).not.toContain('<textarea');
    expect(card).toContain('address.address');
    expect(card).toContain('No delivery address is recorded');
  });

  it('is wired into checkout and the order detail with an honest label', () => {
    const checkout = read('app/retailer/checkout/page.tsx');
    // Address selection lives in CheckoutAddressSelector, which still renders
    // the same honest DeliveryAddressCard for every option (saved entries and
    // the registered shop address fallback).
    expect(checkout).toContain('CheckoutAddressProvider');
    expect(checkout).toContain('CheckoutAddressSelector');
    expect(read('components/retailer/checkout-address-selector.tsx')).toContain('DeliveryAddressCard');
    expect(checkout).toContain("select('area_id, credit_limit, outstanding_balance, shop_name, address, areas ( name, district )')");
    // Settlement is coins + cash on delivery — the credit terms copy is gone.
    expect(checkout).toContain('CoinsCheckoutSummary');
    expect(checkout).not.toContain('Payment terms (for example Net-15 or Net-30)');

    const detail = read('app/retailer/orders/[id]/page.tsx');
    expect(detail).toContain('DeliveryAddressCard');
    // Orders now freeze the chosen address (0036); the honest label says so.
    expect(detail).toContain('shipping_address');
    expect(detail).toContain('Delivery address frozen when the order was placed');
    expect(detail).toContain('/retailer/account/ledger');
  });

  it('does not invent payment terms or a selectable method', () => {
    const checkout = read('app/retailer/checkout/page.tsx');
    expect(checkout).not.toMatch(/name="paymentMethod"/);
    expect(checkout).not.toMatch(/net15|net30|net_15|net_30/i);
    // No credit wording at all in the current checkout: coins + cash on delivery.
    expect(checkout).not.toMatch(/Business credit account|Credit limit|Available credit|Outstanding/);
    expect(checkout).toContain('CoinsCheckoutSummary');
    expect(checkout).toContain('Payable on delivery');
  });
});

describe('cart mutations stay owner-scoped', () => {
  const actions = read('lib/retailer/cart-actions.ts');
  const service = read('lib/retailer/cart-service.ts');

  it('exposes clear-cart through the existing owner-scoped service', () => {
    expect(actions).toContain('export async function clearCartAction(');
    expect(actions).toContain('clearRetailerCart((await createClient()), user.id)');
    expect(service).toContain("from('cart_items').delete().eq('retailer_id', retailerId)");
  });

  it('validates MOQ and availability before a line is written', () => {
    const validation = read('lib/retailer/cart-validation.ts');
    expect(validation).toContain('export async function validatePackForCart(');
    expect(validation).toContain('Minimum order quantity for this pack is');
    expect(validation).toContain("if (!pack.is_active) return 'This pack is currently unavailable.'");
    expect(validation).toContain("if (!pack.products?.is_active) return 'This product is currently unavailable.'");
    expect(validation).toContain('getProductPriceOverride(supabase, pack.product_id, retailerId, retailer.area_id)');
    expect(service).toContain('validatePackForCart(supabase, retailerId, item.pack_id, quantity)');
  });

  it('revalidates on the server even though the client mirrors the rule', () => {
    const row = read('components/retailer/cart-item-row.tsx');
    expect(row).toContain('the server action remains');
    expect(row).toContain('updateCartQuantityAction');
  });
});

describe('home renders only real retailer history', () => {
  const home = read('app/retailer/home/page.tsx');
  const personalization = read('lib/retailer/home-data.ts');
  const view = read('components/retailer/home-content.tsx');

  it('offers Buy again from the retailer’s own last order, priced today', () => {
    expect(home).toContain('loadRetailerHome(supabase, user.id');
    expect(view).toContain('data.reorders.length');
    expect(view).toContain('Buy again');
    expect(personalization).toContain('priceCatalogPack(pack, product, pricingData, quantity)');
    expect(personalization).toContain("eq('retailer_id', retailerId)");
  });

  it('never invents a sales figure or a popularity count', () => {
    expect(home).not.toMatch(/soldCount|unitsSold|fakeSales|Math\.random/);
    expect(personalization).not.toMatch(/Math\.random/);
    // No catalog-price fallback is mislabeled as a sales ranking.
    expect(view).toContain('Frequently ordered by you');
    expect(personalization).toContain('history.frequency.entries()');
  });

  it('keeps banners scoped to the retailer’s area and active window', () => {
    expect(personalization).toContain("eq('is_active', true)");
    expect(personalization).toContain('isBannerVisible(banner, areaId');
    const schedule = read('lib/retailer/banner-target.ts');
    expect(schedule).toContain('banner.area_id === areaId');
    // Scheduling is inclusive and IST-aware: a start date begins at 00:00 IST
    // and an end date covers the WHOLE day, so a banner never disappears on its
    // own end date. (Replaces the old hasStarted/hasNotEnded pair.)
    expect(schedule).toContain('bannerScheduleInstants');
    expect(schedule).toContain('IST_OFFSET_MS');
    expect(schedule).toContain("boundedInstant(endsAt, 'end')");
  });
});

describe('variant pricing stays server-resolved', () => {
  it('reuses the shared catalog select so a rail cannot price with units_per_case = 1', () => {
    const personalization = read('lib/retailer/personalization.ts');
    expect(personalization).toContain('PRODUCT_CARD_SELECT');
    expect(personalization).not.toMatch(/product_packs \( id, pack_name, ptr, base_price, case_price, mrp/);
    const catalog = read('lib/retailer/catalog.ts');
    expect(catalog).toContain('units_per_case');
    expect(catalog).toContain('image_url');
  });

  it('keeps the best-value badge mathematically justified', () => {
    const variants = read('lib/retailer/variants.ts');
    expect(variants).toContain('markBestValueVariant');
    expect(variants).toContain('priced.length < 2');
    expect(variants).toContain('0.005');
  });
});

describe('migration hygiene', () => {
  const migrationsDir = join(root, 'supabase/migrations');
  const migrations = readdirSync(migrationsDir).filter((file) => file.endsWith('.sql')).sort();

  it('is strictly ordered with unique prefixes and only the documented reservations', () => {
    const numbers = migrations.map((file) => Number(file.slice(0, 4)));
    expect(new Set(numbers).size).toBe(numbers.length);
    expect(numbers).toEqual([...numbers].sort((a, b) => a - b));

    const present = new Set(numbers);
    const missing = Array.from(
      { length: Math.max(...numbers) },
      (_, index) => index + 1
    ).filter((number) => !present.has(number));
    // Documented gaps, never reused:
    //   0061 — deliberately never shipped; deployed 0062–0068 identities
    //          cannot be renumbered without corrupting migration history.
    //   0075 — data-retention archive, ON HOLD pending review.
    //   0076 — banner alt_text proposal, deliberately deferred.
    // 0077 (banner draft artwork) skips over them rather than taking a number
    // that a reviewed, pending change has already been designed against.
    // 0103 is reserved by the open security-advisor branch (PR #127); the website
    // content migrations deliberately start at 0104 so the two never collide.
    expect(missing).toEqual([61, 75, 76, 103]);
  });

  it('keeps the case/loose pricing migration and adds Powder catalog integrity plus variant gallery plus wallet ledger plus security hardening as the latest migrations', () => {
    expect(existsSync(join(migrationsDir, '0026_case_and_loose_piece_pricing.sql'))).toBe(true);
    expect(existsSync(join(migrationsDir, '0027_powder_category_and_catalog_constraints.sql'))).toBe(true);
    expect(existsSync(join(migrationsDir, '0028_product_pack_gallery.sql'))).toBe(true);
    expect(existsSync(join(migrationsDir, '0029_retailer_wallet_ledger.sql'))).toBe(true);
    expect(existsSync(join(migrationsDir, '0030_wallet_rpc_security.sql'))).toBe(true);
    expect(existsSync(join(migrationsDir, '0031_wallet_outstanding_opening_baseline.sql'))).toBe(true);
    // Retailer premium upgrade (address book, saved carts, product feedback,
    // profile RPC/prefs/requests, order address snapshot) — additive chain.
    expect(existsSync(join(migrationsDir, '0032_retailer_address_book.sql'))).toBe(true);
    expect(existsSync(join(migrationsDir, '0033_retailer_saved_carts.sql'))).toBe(true);
    expect(existsSync(join(migrationsDir, '0034_retailer_product_feedback.sql'))).toBe(true);
    expect(existsSync(join(migrationsDir, '0035_retailer_profile_rpc_prefs_requests.sql'))).toBe(true);
    expect(existsSync(join(migrationsDir, '0036_order_shipping_address.sql'))).toBe(true);
    const latest = migrations[migrations.length - 1] as string;
    expect(latest > '0036_order_shipping_address.sql').toBe(true); // later phases append, never reorder
  });

  it('keeps the case + loose migration additive — no destructive statement, no RLS change', () => {
    const sql = read('supabase/migrations/0026_case_and_loose_piece_pricing.sql').toLowerCase();
    // Nothing is dropped, truncated or deleted: history and carts survive.
    expect(sql).not.toMatch(/drop column/i);
    expect(sql).not.toMatch(/drop table/i);
    expect(sql).not.toMatch(/truncate /i);
    expect(sql).not.toMatch(/delete from/i);
    // The only constraint removed is the tier rule_type check, immediately
    // re-added as a superset so existing rows keep their meaning.
    expect(sql).toMatch(/drop constraint if exists product_pricing_tiers_rule_type_check/);
    expect(sql.match(/drop constraint if exists/g) ?? []).toHaveLength(2);
    // Case price stays the single source of truth — the migration never adds a
    // competing case-price column.
    expect(sql).not.toMatch(/add column case_price/i);
    expect(sql).toMatch(/allow_loose_pieces boolean not null default true/);
    expect(sql).toMatch(/rule_type in \('default', 'case', 'bulk', 'loose'\)/);
    expect(sql).toMatch(/quantity_unit text not null default 'packs'/);
    // RLS is inherited, never relaxed: no policy is created, dropped or altered.
    expect(sql).not.toMatch(/create policy/i);
    expect(sql).not.toMatch(/drop policy/i);
    expect(sql).not.toMatch(/alter table .* enable row level security/i);
    // No privilege statements at all (comments may mention them, DDL may not).
    expect(sql).not.toMatch(/^\s*grant /im);
    expect(sql).not.toMatch(/^\s*revoke /im);
    expect(sql).not.toMatch(/alter default privileges/i);
  });

  it('enables RLS on every retailer-facing table across the history', () => {
    const all = migrations.map((file) => read(`supabase/migrations/${file}`).toLowerCase()).join('\n');
    for (const table of [
      'cart_items',
      'orders',
      'order_items',
      'notifications',
      'retailer_favorites',
      'retailers',
      'profiles',
      'order_status_history',
    ]) {
      expect(all, `${table} must have RLS enabled`).toContain(`alter table ${table} enable row level security`);
    }
  });

  it('never disables RLS anywhere in the migration history', () => {
    const all = migrations.map((file) => read(`supabase/migrations/${file}`).toLowerCase()).join('\n');
    expect(all).not.toContain('disable row level security');
    expect(all).not.toContain('force row level security');
  });
});
