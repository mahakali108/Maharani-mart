import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  CATALOG_MAX_ROWS,
  CATALOG_PAGE_SIZE,
  catalogHref,
  catalogPageHref,
  catalogPageRange,
  catalogTotalPages,
  hasDerivedPriceConstraints,
  isDbSortable,
  parseCatalogPage,
  parseCatalogSort,
  sanitizeSearchTerm,
  type CatalogQuery,
} from '@/lib/retailer/catalog-params';
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

describe('catalog pagination math', () => {
  it('parses ?page= defensively', () => {
    expect(parseCatalogPage(undefined)).toBe(1);
    expect(parseCatalogPage('')).toBe(1);
    expect(parseCatalogPage('abc')).toBe(1);
    expect(parseCatalogPage('0')).toBe(1);
    expect(parseCatalogPage('-5')).toBe(1);
    expect(parseCatalogPage('3')).toBe(3);
    expect(parseCatalogPage('2.9')).toBe(2);
    // A huge value cannot request an arbitrarily deep range.
    expect(parseCatalogPage('99999999')).toBeLessThanOrEqual(500);
  });

  it('maps a 1-based page to inclusive PostgREST range bounds', () => {
    expect(catalogPageRange(1, 24)).toEqual({ from: 0, to: 23 });
    expect(catalogPageRange(2, 24)).toEqual({ from: 24, to: 47 });
    expect(catalogPageRange(3, 24)).toEqual({ from: 48, to: 71 });
    expect(catalogPageRange(0, 24)).toEqual({ from: 0, to: 23 });
    // Consecutive pages never overlap and never skip a row.
    const first = catalogPageRange(1, CATALOG_PAGE_SIZE);
    const second = catalogPageRange(2, CATALOG_PAGE_SIZE);
    expect(second.from).toBe(first.to + 1);
  });

  it('always reports at least one page', () => {
    expect(catalogTotalPages(0, 24)).toBe(1);
    expect(catalogTotalPages(-3, 24)).toBe(1);
    expect(catalogTotalPages(1, 24)).toBe(1);
    expect(catalogTotalPages(24, 24)).toBe(1);
    expect(catalogTotalPages(25, 24)).toBe(2);
    expect(catalogTotalPages(240, 24)).toBe(10);
  });

  it('drops ?page= from every filter/sort link so a change lands on page 1', () => {
    const values: CatalogQuery = { q: 'oil', category: 'c1', sort: 'price-low', page: '7' };
    expect(catalogHref(values)).not.toContain('page=');
    expect(catalogHref(values)).toContain('q=oil');
    expect(catalogHref({ ...values, page: '7' })).toBe(catalogHref({ ...values, page: undefined }));
  });

  it('keeps the active filter state on pagination links', () => {
    const values: CatalogQuery = { q: 'oil', category: 'c1', sort: 'price-low' };
    expect(catalogPageHref(values, 1)).toBe(catalogHref(values));
    const next = catalogPageHref(values, 2);
    expect(next).toContain('page=2');
    expect(next).toContain('q=oil');
    expect(next).toContain('category=c1');
    expect(next).toContain('sort=price-low');
    expect(next.startsWith('/retailer/catalog?')).toBe(true);
  });

  it('knows which sorts SQL can express and which need resolved prices', () => {
    expect(isDbSortable('recommended')).toBe(true);
    expect(isDbSortable('name')).toBe(true);
    expect(isDbSortable('newest')).toBe(true);
    expect(isDbSortable('price-low')).toBe(false);
    expect(isDbSortable('price-high')).toBe(false);
    expect(isDbSortable('discount')).toBe(false);
    expect(isDbSortable('frequent')).toBe(false);
    for (const sort of ['recommended', 'price-low', 'price-high', 'discount', 'newest', 'frequent', 'name'] as const) {
      expect(parseCatalogSort(sort)).toBe(sort);
    }
    expect(parseCatalogSort('nonsense')).toBe('recommended');
  });

  it('routes every price-dependent constraint to the bounded in-memory mode', () => {
    const base = { sort: 'recommended' as const, minPrice: null, maxPrice: null, minDiscount: null, maxMoq: null, onlyOffers: false };
    expect(hasDerivedPriceConstraints(base)).toBe(false);
    expect(hasDerivedPriceConstraints({ ...base, minPrice: 10 })).toBe(true);
    expect(hasDerivedPriceConstraints({ ...base, maxPrice: 10 })).toBe(true);
    expect(hasDerivedPriceConstraints({ ...base, minDiscount: 5 })).toBe(true);
    expect(hasDerivedPriceConstraints({ ...base, maxMoq: 2 })).toBe(true);
    expect(hasDerivedPriceConstraints({ ...base, onlyOffers: true })).toBe(true);
    expect(hasDerivedPriceConstraints({ ...base, sort: 'price-low' })).toBe(true);
    expect(hasDerivedPriceConstraints({ ...base, sort: 'frequent' })).toBe(true);
    // A DB-sortable sort with no price constraint stays fully DB-paginated.
    expect(hasDerivedPriceConstraints({ ...base, sort: 'name' })).toBe(false);
  });

  it('keeps the working-set cap a sane multiple of the page size', () => {
    expect(CATALOG_MAX_ROWS).toBeGreaterThan(CATALOG_PAGE_SIZE);
    expect(CATALOG_MAX_ROWS % CATALOG_PAGE_SIZE).toBe(0);
  });

  it('still strips PostgREST metacharacters from a search term', () => {
    expect(sanitizeSearchTerm('500g Oil%,_*')).toBe('500g Oil');
    expect(sanitizeSearchTerm('a'.repeat(300))).toHaveLength(80);
  });
});

describe('catalog page wiring', () => {
  const page = read('app/retailer/catalog/page.tsx');

  it('paginates in the database when it safely can', () => {
    expect(page).toContain('.range(from, to)');
    expect(page).toContain("count: 'exact'");
    expect(page).toContain('catalogPageRange(');
    expect(page).toContain('catalogTotalPages(');
  });

  it('bounds the in-memory working set instead of fetching the whole catalog', () => {
    expect(page).toContain('.limit(CATALOG_MAX_ROWS)');
    expect(page).toContain('resultCapped');
  });

  it('renders pagination controls and tells the truth when the cap binds', () => {
    expect(page).toContain('catalogPageHref(filterValues, page - 1)');
    expect(page).toContain('catalogPageHref(filterValues, page + 1)');
    expect(page).toContain('Page {page} of {totalPages}');
    expect(page).toContain('Narrow the search or pick a category to see the rest');
  });

  it('searches variant/size and barcode but never an internal SKU', () => {
    expect(page).toContain('pack_name.ilike');
    expect(page).toContain('barcode.ilike');
    expect(page).not.toContain('sku_code');
    expect(page).not.toContain('pack_sku_code');
  });

  it('only pays for the order-frequency ranking when that sort is requested', () => {
    expect(page).toContain("sort === 'frequent'");
    expect(page).toContain('getOrderFrequencyMap');
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
    const frequentBlock = page.match(
      /if \(sort === 'frequent' && frequency\.size > 0\) \{[\s\S]*?\n  \}/
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
    expect(page).toContain(
      "if (sort === 'frequent') return b.timesOrdered - a.timesOrdered || Number(b.isNewLaunch) - Number(a.isNewLaunch);"
    );
    // `timesOrdered` is derived from this retailer's own order_items, so the
    // ranking is real history. There is no popularity/bestseller/trending
    // column in the schema and none is fabricated here: every SQL ORDER BY on
    // this page must name a column that genuinely exists.
    const orderByColumns = [...page.matchAll(/\.order\('([a-z_]+)'/g)].map((match) => match[1]);
    expect(orderByColumns.length).toBeGreaterThan(0);
    for (const column of orderByColumns) {
      expect(['name', 'created_at', 'is_new_launch', 'sort_order']).toContain(column);
    }
    expect(page).not.toMatch(/\.order\('(popularity|sales_rank|bestseller|trending_score)'/);
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

  it('states the payment/adjustment gap plainly instead of implying a full statement', () => {
    expect(LEDGER_PAYMENT_GAP_NOTICE).toMatch(/not yet itemised/i);
    expect(LEDGER_PAYMENT_GAP_NOTICE).toMatch(/authoritative/i);
    expect(LEDGER_PAGE_SIZE).toBeGreaterThan(0);
  });
});

describe('ledger page never fabricates a financial position', () => {
  const page = read('app/retailer/account/ledger/page.tsx');
  const lib = read('lib/retailer/ledger.ts');

  it('reuses the single credit implementation used by checkout', () => {
    expect(lib).toContain("from '@/lib/orders/credit'");
    expect(lib).toContain('calculateCreditPosition(');
    expect(lib).toContain('roundMoney');
  });

  it('reads only the retailer’s own rows', () => {
    expect(lib).toContain(".eq('retailer_id', retailerId)");
    expect(lib).toContain(".eq('id', retailerId)");
    expect(lib).toContain(".from('orders')");
    expect(lib).toContain(".from('retailers')");
  });

  it('computes no running balance, because payments are not recorded anywhere', () => {
    expect(lib).not.toMatch(/runningBalance|balanceAfter|balance_after/i);
    expect(page).not.toMatch(/runningBalance|balanceAfter/i);
    expect(page).toContain('LEDGER_PAYMENT_GAP_NOTICE');
  });

  it('is server-only, paginated and links to the real order', () => {
    expect(lib).toContain("import 'server-only'");
    expect(lib).toContain('.range(from, to)');
    expect(page).toContain('/retailer/orders/${entry.orderId}');
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
    expect(create).toContain('quoteOrderForRetailer({ retailerId, lines, supabase })');
    expect(create).toContain('quote.credit.exceedsLimit');
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
    for (const file of ['app/retailer/checkout/page.tsx', 'app/retailer/cart/page.tsx', 'app/retailer/catalog/[id]/page.tsx']) {
      const source = read(file);
      expect(source, file).toContain('caseLineBreakdown(');
      // Adding GST would look like `* (1 + gst/100)` or `subtotal + gst*qty`.
      expect(source, file).not.toMatch(/\*\s*\(1\s*\+\s*gst/);
      expect(source, file).not.toMatch(/gst_percent\s*\/\s*100\s*\)/);
    }
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
    expect(checkout).toContain('DeliveryAddressCard');
    expect(checkout).toContain("select('area_id, credit_limit, outstanding_balance, shop_name, address, areas ( name, district )')");
    expect(checkout).toContain('Payment terms (for example Net-15 or Net-30) are set by your distributor');

    const detail = read('app/retailer/orders/[id]/page.tsx');
    expect(detail).toContain('DeliveryAddressCard');
    expect(detail).toContain('orders do not store their own address snapshot'.replace('orders', 'Orders'));
    expect(detail).toContain('/retailer/account/ledger');
  });

  it('does not invent payment terms or a selectable method', () => {
    const checkout = read('app/retailer/checkout/page.tsx');
    expect(checkout).not.toMatch(/name="paymentMethod"/);
    expect(checkout).not.toMatch(/net15|net30|net_15|net_30/i);
    expect(checkout).toContain('Business credit account');
  });
});

describe('cart mutations stay owner-scoped', () => {
  const actions = read('lib/retailer/cart-actions.ts');
  const service = read('lib/retailer/cart-service.ts');

  it('exposes clear-cart through the existing owner-scoped service', () => {
    expect(actions).toContain('export async function clearCartAction(');
    expect(actions).toContain('clearRetailerCart(createClient(), user.id)');
    expect(service).toContain("from('cart_items').delete().eq('retailer_id', retailerId)");
  });

  it('validates MOQ and availability before a line is written', () => {
    expect(service).toContain('export async function validatePackForCart(');
    expect(service).toContain('Minimum order quantity for this pack is');
    expect(service).toContain("if (!pack.is_active) return 'This pack is currently unavailable.'");
    expect(service).toContain("if (!pack.products?.is_active) return 'This product is currently unavailable.'");
  });

  it('revalidates on the server even though the client mirrors the rule', () => {
    const row = read('components/retailer/cart-item-row.tsx');
    expect(row).toContain('the server action remains');
    expect(row).toContain('updateCartQuantityAction');
  });
});

describe('home renders only real retailer history', () => {
  const home = read('app/retailer/home/page.tsx');
  const personalization = read('lib/retailer/personalization.ts');

  it('offers Buy again from the retailer’s own last order, priced today', () => {
    expect(home).toContain('getBuyAgainCards(');
    expect(home).toContain('buyAgainCards.length > 0');
    expect(home).toContain('Buy again');
    expect(personalization).toContain("eq('retailer_id', retailerId)");
  });

  it('never invents a sales figure or a popularity count', () => {
    expect(home).not.toMatch(/soldCount|unitsSold|fakeSales|Math\.random/);
    expect(personalization).not.toMatch(/Math\.random/);
    // "Best selling" comes from this retailer's own order frequency, or from a
    // deterministic catalog ordering when they have no history yet.
    expect(home).toContain('frequentCards.length > 0 ? frequentCards : discovery.bestPrices');
  });

  it('keeps banners scoped to the retailer’s area and active window', () => {
    expect(home).toContain("eq('is_active', true)");
    expect(home).toContain('banner.area_id === retailer?.area_id');
    expect(home).toContain('hasStarted');
    expect(home).toContain('hasNotEnded');
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

  it('is sequentially numbered with no duplicate or skipped prefix', () => {
    const prefixes = migrations.map((file) => file.slice(0, 4));
    expect(new Set(prefixes).size).toBe(prefixes.length);
    prefixes.forEach((prefix, index) => {
      expect(Number(prefix)).toBe(index + 1);
    });
  });

  it('adds 0026 (case + loose piece pricing) as the latest migration', () => {
    expect(migrations[migrations.length - 1]).toBe('0026_case_and_loose_piece_pricing.sql');
    expect(existsSync(join(migrationsDir, '0026_case_and_loose_piece_pricing.sql'))).toBe(true);
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
