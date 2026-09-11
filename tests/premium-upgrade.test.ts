import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseBulkOrderLines } from '@/lib/retailer/bulk-shared';
import { formatAddressLine, parseAddressForm } from '@/lib/retailer/address-shared';
import { computeProfileCompletion } from '@/lib/retailer/profile-completion';
import { aggregateTotals, buildMonthTrend, statementCsv, EMPTY_TOTALS } from '@/lib/retailer/reports';
import { availabilityBadge, isOutOfStock, normalizeAvailabilityState } from '@/lib/retailer/availability';

const ROOT = join(__dirname, '..');
const read = (relative: string) => readFileSync(join(ROOT, relative), 'utf8');
const migrationsDir = join(ROOT, 'supabase', 'migrations');
const migrations = readdirSync(migrationsDir).filter((file) => file.endsWith('.sql')).sort();

describe('premium upgrade — bulk order entry', () => {
  it('parses leading quantity, trailing quantity and bare terms', () => {
    const lines = parseBulkOrderLines('2 x Tata Salt 1kg\nParle-G 800g x 3\nAmul Gold\n\n');
    expect(lines).toHaveLength(3);
    expect(lines[0]).toMatchObject({ quantity: 2, term: 'Tata Salt 1kg' });
    expect(lines[1]).toMatchObject({ quantity: 3, term: 'Parle-G 800g' });
    expect(lines[2]).toMatchObject({ quantity: null, term: 'Amul Gold' });
    expect(lines).toHaveLength(3);
  });

  it('accepts unicode multiplication sign and asterisk, rejects invalid quantities', () => {
    const lines = parseBulkOrderLines('3×tea 250g\n5*buiscut\n9999999 x rice\n0 x rice');
    expect(lines[0]).toMatchObject({ quantity: 3 });
    expect(lines[1]).toMatchObject({ quantity: 5 });
    // Out-of-range and zero quantities fall back to "choose later".
    expect(lines[2]?.quantity).toBeNull();
    expect(lines[3]?.quantity).toBeNull();
  });

  it('sanitizes search-hostile characters out of terms and dedupes lines', () => {
    const lines = parseBulkOrderLines('colgate%,_* 100g\nCOLGATE 100g');
    expect(lines).toHaveLength(1);
    expect(lines[0]?.term).toBe('colgate 100g');
  });

  it('caps the number of parsed lines', () => {
    const raw = Array.from({ length: 40 }, (_, i) => `item number ${i}`).join('\n');
    expect(parseBulkOrderLines(raw)).toHaveLength(20);
  });

  it('addBulkLinesAction source de-duplicates by pack and validates through the shared cart service', () => {
    const source = read('lib/retailer/bulk-order-actions.ts');
    expect(source).toContain('addCartLines');
    expect(source).toContain('byPack.set(line.packId, line.quantity)');
    // The action accepts ONLY (packId, quantity) from the client — no money value.
    expect(source).toContain('addBulkLinesAction(lines: { packId: string; quantity: number }[])');
    expect(source).toContain('!Number.isInteger(line.quantity)');
  });
});

describe('premium upgrade — address book', () => {
  it('formats the one-line delivery address identically everywhere', () => {
    expect(
      formatAddressLine({ line1: 'Shop 4, Main Road', line2: 'Ward 7', landmark: 'Near Bus Stand', city: 'Khagaria', district: 'Khagaria', state: 'Bihar', pincode: '851204' })
    ).toBe('Shop 4, Main Road, Ward 7, Near Bus Stand, Khagaria, Khagaria, Bihar, 851204');
    expect(formatAddressLine({ line1: 'A', city: 'B', pincode: 'C' })).toBe('A, B, C');
  });

  it('rejects malformed addresses before any write', () => {
    const bad = (field: string, value: string) => {
      const formData = new FormData();
      formData.set('label', 'Shop');
      formData.set('receiverName', 'Ramesh');
      formData.set('phone', '9876543210');
      formData.set('line1', 'Main Road shop');
      formData.set('city', 'Khagaria');
      formData.set('pincode', '851204');
      formData.set(field, value);
      return parseAddressForm(formData);
    };
    expect(bad('pincode', '8512').ok).toBe(false);
    expect(bad('phone', 'nine eight').ok).toBe(false);
    expect(bad('line1', 'ab').ok).toBe(false);
    expect(bad('label', '').ok).toBe(false);

    const good = new FormData();
    good.set('label', 'Godown');
    good.set('receiverName', 'Ramesh Kumar');
    good.set('phone', '+91 98765 43210');
    good.set('line1', 'Shop 12, Station Road');
    good.set('city', 'Khagaria');
    good.set('pincode', '851204');
    good.set('isDefault', 'on');
    const parsed = parseAddressForm(good);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.value.isDefault).toBe(true);
  });

  it('migration 0032 is additive with owner-only RLS on retailer_addresses', () => {
    const sql = read('supabase/migrations/0032_retailer_address_book.sql');
    expect(sql).toContain('create table if not exists retailer_addresses');
    expect(sql).toContain('alter table retailer_addresses enable row level security');
    expect(sql.match(/retailer_id = auth\.uid\(\)/g)?.length).toBeGreaterThanOrEqual(4);
    expect(sql).not.toMatch(/drop table|truncate|delete from/i);
  });
});

describe('premium upgrade — saved carts', () => {
  it('migration 0033 stores only pack references and quantities — never prices', () => {
    const sql = read('supabase/migrations/0033_retailer_saved_carts.sql');
    expect(sql).toContain('create table if not exists retailer_saved_carts');
    expect(sql).toContain('create table if not exists retailer_saved_cart_items');
    // Scan the DDL (comments stripped): no money column of any kind.
    const ddl = sql
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('--'))
      .join('\n');
    expect(ddl).not.toMatch(/price|amount|paise/i);
    expect(ddl).toContain('alter table retailer_saved_cart_items enable row level security');
  });

  it('saved-cart actions re-validate availability at restore and merge via the shared merge path', () => {
    const source = read('lib/retailer/saved-cart-actions.ts');
    expect(source).toContain('mergeLinesIntoCart');
    // Prices are never persisted or trusted on restore.
    expect(source).not.toMatch(/case_price|base_price|unit_price/);
    // Restore re-checks the CURRENT pack state.
    expect(source).toContain('pack.is_active');
    expect(source).toContain('pack.products?.is_active');
    expect(source).toContain('item.quantity < pack.moq');
  });
});

describe('premium upgrade — profile completion', () => {
  it('computes 0% when everything is missing', () => {
    const result = computeProfileCompletion({ fullName: '', phone: null, shopName: undefined, address: '', gstin: null });
    expect(result.percent).toBe(0);
    expect(result.missing).toContain('GSTIN');
    expect(result.missing).toContain('Delivery address');
  });

  it('computes 100% when every real field exists', () => {
    const result = computeProfileCompletion({
      fullName: 'Ramesh Kumar',
      phone: '9876543210',
      shopName: 'Ramesh Store',
      address: 'Main Road',
      gstin: '10ABCDE1234F1Z5',
      addressCount: 1,
    });
    expect(result.percent).toBe(100);
    expect(result.missing).toHaveLength(0);
  });

  it('whitespace-only values never count as filled', () => {
    const result = computeProfileCompletion({ fullName: '   ', phone: '9876543210', shopName: 'Shop', address: 'Addr', gstin: 'GSTIN', addressCount: 0 });
    expect(result.percent).toBe(75);
    expect(result.missing).toEqual(['Owner name', 'Delivery address']);
  });
});

describe('premium upgrade — reports', () => {
  const orders = [
    { status: 'delivered', subtotal: 1000, gst_total: 180, discount_total: 50, grand_total: 1130, collected_by: null },
    { status: 'pending', subtotal: 500, gst_total: 90, discount_total: 0, grand_total: 590, collected_by: null },
    { status: 'cancelled', subtotal: 700, gst_total: 126, discount_total: 10, grand_total: 816, collected_by: null },
  ];

  it('aggregates purchase value as subtotal − discount + GST and excludes cancelled orders', () => {
    const totals = aggregateTotals(orders);
    expect(totals.orderCount).toBe(2);
    expect(totals.purchaseValue).toBeCloseTo(1000 - 50 + 180 + (500 + 90));
    expect(totals.gstTotal).toBeCloseTo(270);
    expect(totals.discountTotal).toBeCloseTo(50);
  });

  it('returns empty totals for no orders', () => {
    expect(aggregateTotals([])).toEqual(EMPTY_TOTALS);
  });

  it('builds a six-month trend with IST-calendar bucketing and no future buckets', () => {
    const now = new Date('2026-09-11T10:00:00Z');
    const trend = buildMonthTrend(
      [
        { placed_at: '2026-09-02T06:00:00Z', status: 'delivered', subtotal: 100, discount_total: 0, gst_total: 18 },
        { placed_at: '2026-09-01T19:30:00Z', status: 'delivered', subtotal: 200, discount_total: 0, gst_total: 36 }, // Sep 2 IST
        { placed_at: '2026-08-20T05:00:00Z', status: 'cancelled', subtotal: 999, discount_total: 0, gst_total: 0 },
        { placed_at: '2026-03-01T05:00:00Z', status: 'delivered', subtotal: 50, discount_total: 0, gst_total: 9 }, // older than 6 months → dropped
      ],
      6,
      now
    );
    expect(trend).toHaveLength(6);
    const currentMonth = trend[5];
    const firstMonth = trend[0];
    expect(currentMonth?.monthKey).toBe('2026-09');
    expect(currentMonth?.orderCount).toBe(2);
    expect(currentMonth?.purchaseValue).toBeCloseTo(100 + 18 + 200 + 36);
    expect(firstMonth?.monthKey).toBe('2026-04');
    expect(trend.every((row) => row.purchaseValue >= 0)).toBe(true);
  });

  it('renders a CSV statement with quoting that survives commas and quotes', () => {
    const csv = statementCsv([
      { orderNumber: 'MT-001', placedAt: '2026-09-01T05:30:00Z', status: 'delivered', subtotal: 100, discountTotal: 0, gstTotal: 18, grandTotal: 118 },
    ]);
    const lines = csv.split('\n');
    expect(lines[0]).toBe('Order number,Placed on (IST),Status,Subtotal (Rs),Discount (Rs),GST (Rs),Grand total (Rs)');
    expect(lines[1]).toContain('"MT-001"');
    expect(csv).not.toContain('cost');
  });
});

describe('premium upgrade — availability vocabulary', () => {
  it('normalizes RPC values and maps them to honest labels', () => {
    expect(normalizeAvailabilityState('in_stock')).toBe('in_stock');
    expect(normalizeAvailabilityState('weird')).toBe('unknown');
    expect(normalizeAvailabilityState(null)).toBe('unknown');

    const out = availabilityBadge('out_of_stock');
    expect(out?.label).toBe('Unavailable right now');
    expect(availabilityBadge('in_stock')?.label).toBe('Available now');
    expect(availabilityBadge('low_stock')?.label).toBe('Running low');
    expect(availabilityBadge('unknown')).toBeNull();
    expect(isOutOfStock('out_of_stock')).toBe(true);
    expect(isOutOfStock('in_stock')).toBe(false);
  });
});

describe('premium upgrade — security posture of the new surface', () => {
  it('0035 shop-profile RPC updates ONLY shop_name and address for auth.uid()', () => {
    const sql = read('supabase/migrations/0035_retailer_profile_rpc_prefs_requests.sql');
    expect(sql).toContain('security definer');
    expect(sql).toContain('set search_path = public');
    expect(sql).toContain('where id = v_uid');
    // Money, status and assignment columns are unreachable.
    for (const forbidden of ['credit_limit', 'outstanding_balance', 'status', 'area_id', 'approved_by', 'assigned_salesman_id']) {
      const updateBlock = sql.slice(sql.indexOf('update retailers'), sql.indexOf('if not found'));
      expect(updateBlock).not.toContain(forbidden);
    }
    expect(sql).toContain('revoke all on function update_my_shop_profile');
  });

  it('new tables all enable RLS with owner scoping', () => {
    for (const file of ['0032_retailer_address_book.sql', '0033_retailer_saved_carts.sql', '0034_retailer_product_feedback.sql', '0035_retailer_profile_rpc_prefs_requests.sql']) {
      const sql = read(`supabase/migrations/${file}`);
      expect(sql).toMatch(/enable row level security/);
      expect(sql).not.toMatch(/\bdrop table\b/i);
    }
  });

  it('retailer product issues can never be status-edited by a retailer', () => {
    const sql = read('supabase/migrations/0034_retailer_product_feedback.sql');
    expect(sql).toContain('retailer_product_issues_staff_update');
    expect(sql).toContain('is_staff_or_above()');
  });

  it('profile completion, feedback and notification-prefs pages route through server actions, not direct SQL from the client', () => {
    expect(read('lib/retailer/profile-actions.ts')).toContain("updateUser({ password: parsed.data.newPassword })");
    expect(read('lib/retailer/profile-actions.ts')).toContain("signInWithPassword");
    expect(read('components/retailer/product-feedback.tsx')).toContain('reportProductIssueAction');
    expect(read('components/retailer/product-feedback.tsx')).toContain('toggleStockAlertAction');
  });
});

describe('premium upgrade — migration hygiene', () => {
  it('adds 0032–0036 after the wallet baseline and never touches existing tables destructively', () => {
    expect(migrations[migrations.length - 1]).toBe('0036_order_shipping_address.sql');
    for (const file of migrations.slice(-5)) {
      const sql = read(`supabase/migrations/${file}`);
      expect(sql).not.toMatch(/drop table|truncate\b|alter table .* drop column/i);
    }
  });

  it('0036 adds the shipping snapshot as nullable jsonb with a shape check', () => {
    const sql = read('supabase/migrations/0036_order_shipping_address.sql');
    expect(sql).toContain("add column if not exists shipping_address jsonb");
    expect(sql).toContain('orders_shipping_address_shape');
  });

  it('create-order freezes the shipping snapshot server-side and checkout resolves the address server-side', () => {
    const createOrder = read('lib/orders/create-order.ts');
    expect(createOrder).toContain('shipping_address: shippingAddress ?? null');
    const checkout = read('lib/retailer/checkout-actions.ts');
    expect(checkout).toContain("from('retailer_addresses')");
    expect(checkout).toContain("eq('retailer_id', user.id)");
    // No client-supplied address string is ever trusted.
    expect(checkout).not.toMatch(/shippingAddress\s*=\s*JSON\.parse|addressLine: string/);
  });
});
