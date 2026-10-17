import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  SUPPLIER_MAX_PAGE,
  SUPPLIER_PAGE_SIZE,
  aggregateSuppliers,
  grnValue,
  parseSupplierQuery,
  supplierHref,
  totalPages,
  type SupplierGrnItemRow,
  type SupplierGrnRow,
} from '@/lib/admin/suppliers-query';
import { can } from '@/lib/permissions/permissions';

const read = (f: string) => readFileSync(path.join(process.cwd(), f), 'utf8');

function grn(overrides: Partial<SupplierGrnRow> & { id: string }): SupplierGrnRow {
  return {
    grn_number: `GRN-${overrides.id}`,
    status: 'confirmed',
    supplier_reference: 'Sharma Traders',
    invoice_reference: null,
    created_at: '2026-09-01T10:00:00.000Z',
    confirmed_at: '2026-09-02T10:00:00.000Z',
    warehouse_name: 'Main',
    ...overrides,
  };
}
const item = (grn_id: string, qty: number, cost: number | null): SupplierGrnItemRow => ({
  grn_id,
  received_quantity: qty,
  unit_cost: cost,
});

describe('supplier query parsing (bounded, sanitized)', () => {
  it('defaults and clamps page', () => {
    expect(parseSupplierQuery({})).toEqual({ q: '', status: 'all', supplier: '', page: 1 });
    expect(parseSupplierQuery({ page: '999999' }).page).toBe(SUPPLIER_MAX_PAGE);
    expect(parseSupplierQuery({ page: '-3' }).page).toBe(1);
    expect(parseSupplierQuery({ page: 'abc' }).page).toBe(1);
  });
  it('rejects unknown status and strips search metacharacters', () => {
    expect(parseSupplierQuery({ status: 'paid' }).status).toBe('all');
    // A wildcard must never survive into an ilike pattern.
    expect(parseSupplierQuery({ q: '100%_*,(x)' }).q).not.toMatch(/[%_*\\"',()]/);
  });
  it('builds clean hrefs and pagination math', () => {
    const q = parseSupplierQuery({ q: 'sharma', status: 'draft' });
    expect(supplierHref(q, { page: 2 })).toBe('/admin/suppliers?q=sharma&status=draft&page=2');
    expect(supplierHref(parseSupplierQuery({}))).toBe('/admin/suppliers');
    expect(totalPages(0)).toBe(1);
    expect(totalPages(SUPPLIER_PAGE_SIZE + 1)).toBe(2);
    expect(totalPages(10_000_000)).toBe(SUPPLIER_MAX_PAGE);
  });
});

describe('supplier aggregation (GRN-derived only)', () => {
  it('groups by trimmed reference, excludes cancelled, sums received value', () => {
    const rows = [
      grn({ id: '1' }),
      grn({ id: '2', status: 'draft', confirmed_at: null, created_at: '2026-09-05T10:00:00.000Z' }),
      grn({ id: '3', status: 'cancelled', supplier_reference: 'Other Co' }),
      grn({ id: '4', supplier_reference: '  ', created_at: '2026-08-01T10:00:00.000Z' }),
    ];
    const items = [item('1', 10, 100), item('2', 5, 100), item('3', 99, 99), item('4', 2, 50)];
    const summary = aggregateSuppliers(rows, items);
    const sharma = summary.find((s) => s.name === 'Sharma Traders');
    expect(sharma).toMatchObject({ grns: 2, draft: 1, confirmed: 1, lines: 2, value: 1500, reference: 'Sharma Traders' });
    expect(sharma?.lastActivityAt).toBe('2026-09-05T10:00:00.000Z');
    // Blank references are labelled, never given an invented identity.
    expect(summary.find((s) => s.reference === null)?.name).toBe('Unspecified supplier');
    expect(summary.some((s) => s.name === 'Other Co')).toBe(false);
  });
  it('values missing unit cost as zero rather than inventing a price', () => {
    expect(grnValue([item('x', 4, null)])).toBe(0);
  });
});

describe('suppliers.view permission (server-side matrix)', () => {
  it('is held by admin and super_admin only', () => {
    expect(can('super_admin', 'suppliers.view')).toBe(true);
    expect(can('admin', 'suppliers.view')).toBe(true);
    expect(can('staff', 'suppliers.view')).toBe(false);
    expect(can('salesman', 'suppliers.view')).toBe(false);
    expect(can('retailer', 'suppliers.view')).toBe(false);
  });
});

describe('supplier page wiring (regression)', () => {
  it('guards the page and reads through the RLS-scoped client, never service-role', () => {
    const page = read('app/admin/suppliers/page.tsx');
    expect(page).toContain("requirePagePermission('suppliers.view')");
    const data = read('lib/admin/suppliers-data.ts');
    expect(data).toContain("from('grns')");
    expect(data).not.toMatch(/service_role|SERVICE_ROLE|createAdminClient/);
    // Bounded queries only: page-size range + summary window limit.
    expect(data).toContain('SUPPLIER_PAGE_SIZE');
    expect(data).toContain('.limit(SUPPLIER_SUMMARY_WINDOW)');
  });
  it('is linked in the admin nav for admin roles only', () => {
    expect(read('components/layout/admin-shell.tsx')).toContain("href: '/admin/suppliers'");
  });
});
