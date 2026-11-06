import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  classifyWarehouseConfig,
  resolveSingleWarehouse,
  warehouseConfigCustomerMessage,
  warehouseConfigMessage,
} from '@/lib/warehouse/config';

/**
 * SINGLE WAREHOUSE — one active warehouse, resolved centrally.
 *
 * 0 active   → configuration error (never invent a warehouse)
 * 1 active   → that warehouse, always
 * 2+ active  → configuration error (never pick one at random)
 */

const warehouseA = { id: 'wh-a', name: 'Khagaria Main Godown' };
const warehouseB = { id: 'wh-b', name: 'Gogri Depot' };

describe('one active warehouse', () => {
  it('resolves the single active warehouse', () => {
    const result = resolveSingleWarehouse([warehouseA]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.warehouse).toEqual(warehouseA);
      expect(result.count).toBe(1);
    }
  });

  it('is stable regardless of how the rows arrive (no random pick)', () => {
    const first = resolveSingleWarehouse([warehouseA]);
    for (let attempt = 0; attempt < 25; attempt += 1) {
      const again = resolveSingleWarehouse([warehouseA]);
      expect(again.ok && again.warehouse.id).toBe(first.ok && first.warehouse.id);
    }
  });

  it('classifies the configuration as configured', () => {
    expect(classifyWarehouseConfig(1)).toBe('configured');
    expect(warehouseConfigMessage(1)).toBe('Warehouse is configured.');
  });
});

describe('zero active warehouses', () => {
  it('is a configuration error, never an empty warehouse', () => {
    const result = resolveSingleWarehouse([]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('none');
      expect(result.count).toBe(0);
      expect(result.message).toMatch(/no active warehouse/i);
    }
    expect(classifyWarehouseConfig(0)).toBe('none');
  });

  it('tells the operator exactly what to do', () => {
    expect(warehouseConfigMessage(0)).toContain('Admin → Warehouses');
    expect(warehouseConfigMessage(0)).toContain('Configuration error');
    // The customer-facing copy never leaks internal configuration detail.
    expect(warehouseConfigCustomerMessage(0)).not.toContain('warehouse');
  });
});

describe('multiple active warehouses', () => {
  it('is a configuration error rather than an arbitrary choice', () => {
    const result = resolveSingleWarehouse([warehouseA, warehouseB]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('multiple');
      expect(result.count).toBe(2);
      expect(result.message).toMatch(/2 active warehouses/);
    }
    expect(classifyWarehouseConfig(2)).toBe('multiple');
    expect(classifyWarehouseConfig(7)).toBe('multiple');
  });

  it('never silently returns one of the warehouses', () => {
    const many = Array.from({ length: 5 }, (_, index) => ({ id: `wh-${index}`, name: `Depot ${index}` }));
    for (let attempt = 0; attempt < 25; attempt += 1) {
      expect(resolveSingleWarehouse(many).ok).toBe(false);
    }
  });
});

describe('the resolver module itself', () => {
  it('reads ACTIVE rows only and never hardcodes a warehouse uuid', async () => {
    // An inactive warehouse is not a candidate — that is what makes "exactly
    // one ACTIVE warehouse" meaningful, and it is why 0 active rows must not
    // silently fall back to some older, deactivated depot.
    const { readFile } = await import('node:fs/promises');
    const source = await readFile('lib/warehouse/resolver.ts', 'utf8');
    expect(source).toContain(".eq('is_active', true)");
    expect(source).toContain('resolveSingleWarehouse');
    expect(source).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/);
  });

  it('is the only place order placement gets a warehouse id from', async () => {
    const { readFile } = await import('node:fs/promises');
    const createOrder = await readFile('lib/orders/create-order.ts', 'utf8');
    expect(createOrder).toContain('resolveActiveWarehouse');
    // The client cannot send a warehouse id into an order at all.
    expect(createOrder).not.toContain('warehouseId:');
  });
});

// ---------------------------------------------------------------------------
// The resolver against a database double: 0 / 1 / 2+ / unavailable
// ---------------------------------------------------------------------------
function fakeSupabase(rows: { id: string; name: string }[] | null, errorMessage?: string) {
  const chain = {
    select: () => chain,
    eq: () => chain,
    order: () => chain,
    returns: async () => ({ data: rows, error: errorMessage ? { message: errorMessage } : null }),
  };
  return { from: () => chain } as never;
}

describe('resolveActiveWarehouse against the database', () => {
  it('returns the single active row', async () => {
    const { resolveActiveWarehouse } = await import('@/lib/warehouse/resolver');
    const resolved = await resolveActiveWarehouse(fakeSupabase([{ id: 'wh-1', name: 'Main' }]));
    expect(resolved.ok).toBe(true);
    if (resolved.ok) expect(resolved.warehouse.id).toBe('wh-1');
  });

  it('reports 0 active rows as none, 2+ as multiple, and a read failure as unavailable', async () => {
    const { resolveActiveWarehouse } = await import('@/lib/warehouse/resolver');
    const none = await resolveActiveWarehouse(fakeSupabase([]));
    expect(none.ok).toBe(false);
    if (!none.ok) expect(none.reason).toBe('none');

    const many = await resolveActiveWarehouse(fakeSupabase([{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }]));
    expect(many.ok).toBe(false);
    if (!many.ok) expect(many.reason).toBe('multiple');

    const broken = await resolveActiveWarehouse(fakeSupabase(null, 'permission denied'));
    expect(broken.ok).toBe(false);
    if (!broken.ok) expect(broken.reason).toBe('unavailable');
  });

  it('validates a posted warehouse id against the active one instead of trusting it', async () => {
    const { requireWarehouseId } = await import('@/lib/warehouse/resolver');
    const ok = await requireWarehouseId(fakeSupabase([{ id: 'wh-1', name: 'Main' }]), 'wh-1');
    expect(ok).toEqual({ ok: true, warehouseId: 'wh-1' });

    const forged = await requireWarehouseId(fakeSupabase([{ id: 'wh-1', name: 'Main' }]), 'wh-other');
    expect(forged.ok).toBe(false);

    const missing = await requireWarehouseId(fakeSupabase([{ id: 'wh-1', name: 'Main' }]), undefined);
    expect(missing).toEqual({ ok: true, warehouseId: 'wh-1' });

    const unconfigured = await requireWarehouseId(fakeSupabase([]), 'wh-1');
    expect(unconfigured.ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Surfaces: no pickers for the customer, a status field for the operator
// ---------------------------------------------------------------------------
describe('warehouse surfaces', () => {
  const read = (path: string) => readFileSync(path, 'utf8');

  it('never asks a customer to choose a warehouse', async () => {
    const { readdirSync, statSync } = await import('node:fs');
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        const path = `${dir}/${entry}`;
        if (statSync(path).isDirectory()) walk(path);
        else if (/\.tsx?$/.test(entry)) files.push(path);
      }
    };
    walk('app/retailer');
    walk('components/retailer');

    for (const file of files) {
      const source = read(file);
      expect(source, file).not.toMatch(/name=["']warehouse_id["']/);
      expect(source, file).not.toMatch(/warehouseId\s*:/);
      expect(source, file).not.toMatch(/myWarehouse|defaultWarehouseId|warehouse_id:/);
    }
  });

  it('shows the operator which warehouse will be used, as a status — not a picker', async () => {
    // The stock form (admin + staff) and the GRN form render the resolved
    // warehouse; the inventory dashboards resolve it server-side too.
    for (const path of [
      'components/admin/stock-adjustment-form.tsx',
      'components/admin/grn-form.tsx',
    ]) {
      const source = read(path);
      expect(source, path).toContain('WarehouseStatusField');
      expect(source, path).not.toMatch(/name=["']warehouse_id["']/);
    }
    const statusField = read('components/admin/warehouse-status-field.tsx');
    expect(statusField).toContain('assigned automatically');
    expect(statusField).not.toContain('<select');
    // Every page that needs a warehouse asks the resolver, never a form field.
    for (const path of ['app/admin/inventory/page.tsx', 'app/staff/inventory/page.tsx']) {
      expect(read(path), path).toContain('resolveActiveWarehouse');
    }
  });

  it('removes the pending-order warehouse selector but keeps legacy order operations', () => {
    const panel = read('components/admin/order-actions-panel.tsx');
    const detailPage = read('app/admin/orders/[id]/page.tsx');
    expect(panel).not.toMatch(/assignWarehouseAction|selectedWarehouse|warehouse_id|warehouseId/i);
    expect(panel).not.toMatch(/<select/i);
    expect(detailPage).not.toMatch(/from\(['"]warehouses['"]\)/);
    expect(detailPage).not.toMatch(/warehouse_id|warehouseId/);

    const actions = read('lib/admin/orders-actions.ts');
    expect(actions).toContain('assignWarehouseAction');
    expect(actions).toContain("if (!order.simple_stock_mode)");
    expect(actions).toContain("rpc('reserve_order_stock'");
    expect(actions).toContain("rpc('release_order_stock'");
    expect(read('lib/staff/dispatch-actions.ts')).toContain("rpc('consume_order_stock'");
  });

  it('keeps the warehouse schema future-compatible (nothing dropped, columns kept)', async () => {
    const { readdirSync } = await import('node:fs');
    const migrations = readdirSync('supabase/migrations');
    const all = migrations.map((file) => read(`supabase/migrations/${file}`)).join('\n');
    expect(all).not.toMatch(/drop\s+table[^;]*warehouse/i);
    expect(all).not.toMatch(/drop\s+column[^;]*warehouse_id/i);
    // Multi-warehouse stays expressible: warehouse_id columns and the
    // is_active flag exist, so a future move to N warehouses is additive.
    expect(all).toMatch(/create table[^;]*warehouses\s*\(/i);
    expect(all).toMatch(/is_active\s+boolean/i);
    expect(all).toMatch(/warehouse_id\s+uuid/i);
  });
});
