/**
 * Staff assignment scoping (migration 0037, decision D1) — static
 * verification of the RLS migration content. Browser row-level tests need a
 * live Supabase project; what CAN be verified statically is verified here,
 * following the pattern of tests/production-readiness.test.ts.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '..');
const sql = readFileSync(join(ROOT, 'supabase/migrations/0037_staff_scope_policies.sql'), 'utf8');

const stripComments = (text: string) =>
  text
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('--'))
    .join('\n');

const body = stripComments(sql);

describe('0037 is additive and re-runnable', () => {
  it('contains no destructive statements', () => {
    expect(body.toLowerCase()).not.toMatch(/drop table\b/);
    expect(body.toLowerCase()).not.toMatch(/truncate\b/);
    expect(body.toLowerCase()).not.toMatch(/drop column\b/);
    expect(body.toLowerCase()).not.toMatch(/\bdelete from\b/);
    expect(body.toLowerCase()).not.toMatch(/\binsert into\b/); // no seed/business data
    expect(body.toLowerCase()).not.toMatch(/drop function\b/); // create or replace only
  });

  it('pairs every create policy with a drop policy if exists', () => {
    // Every policy 0037 creates must be dropped first (re-runnability).
    // Drops may EXCEED creates: 0037 also retires stale policies from
    // 0001/0005/0014 (areas, warehouses, visits, route_customers reads)
    // that would otherwise survive alongside the scoped replacements —
    // RLS is permissive (OR), so a leftover broad policy defeats scoping.
    const created = [...sql.matchAll(/create policy "([^"]+)" on (\w+)/g)];
    expect(created.length).toBeGreaterThan(0);
    for (const [, name, table] of created) {
      expect(sql).toContain(`drop policy if exists "${name}" on ${table}`);
    }
    // And the known stale policies are explicitly retired.
    for (const stale of [
      '"areas_read" on areas',
      '"areas_staff_insert" on areas',
      '"warehouses_read" on warehouses',
      '"warehouses_staff_insert" on warehouses',
      '"warehouses_staff_update" on warehouses',
      '"route_customers_owner_or_staff" on route_customers',
    ]) {
      expect(sql).toContain(`drop policy if exists ${stale}`);
    }
  });

  it('replaces policies only via drop-if-exists (established 0013/0014 pattern)', () => {
    expect(sql).not.toMatch(/drop policy " without if exists/);
  });
});

describe('0037 helper functions are safe', () => {
  const helpers = [
    'is_area_assigned_to_current_staff',
    'is_warehouse_assigned_to_current_staff',
    'is_retailer_area_assigned_to_current_staff',
    'is_order_assigned_to_current_staff',
    'is_grn_warehouse_assigned_to_current_staff',
    'is_transfer_warehouse_assigned_to_current_staff',
    'can_current_staff_read_profile',
  ];

  it('declares every helper as security definer + stable with pinned search_path', () => {
    for (const helper of helpers) {
      const fnMatch = sql.match(new RegExp(`create or replace function ${helper}\\(`));
      expect(fnMatch, helper).not.toBeNull();
    }
    // One security definer clause per helper (7 helpers).
    expect(sql.match(/security definer/g)?.length).toBe(helpers.length);
    expect(sql.match(/stable security definer set search_path = public, pg_temp/g)?.length).toBe(helpers.length);
  });

  it('every helper is null-safe (null ids can never match)', () => {
    expect(sql.match(/p_\w+ is not null/g)?.length).toBeGreaterThanOrEqual(helpers.length);
  });
});

describe('0037 removes network-wide staff access (decision D1)', () => {
  it('keeps is_admin_or_above() as the full-access branch in every replaced policy', () => {
    expect(sql.match(/is_admin_or_above\(\)/g)?.length).toBeGreaterThanOrEqual(30);
  });

  it('no replaced policy relies on is_staff_or_above() any more', () => {
    // The staff branch is now explicit: current_user_role() = 'staff' AND an
    // assignment-scoped predicate.
    expect(body).not.toContain('is_staff_or_above()');
  });

  it('scopes the staff branch by assignment in every policy', () => {
    const staffBranches = sql.match(/current_user_role\(\) = 'staff'/g)?.length ?? 0;
    expect(staffBranches).toBeGreaterThanOrEqual(25);
    expect(sql).toContain('is_warehouse_assigned_to_current_staff(warehouse_id)');
    expect(sql).toContain('is_retailer_area_assigned_to_current_staff(retailer_id)');
    expect(sql).toContain('is_retailer_area_assigned_to_current_staff(id)');
  });

  it('preserves the retailer self-cancel and salesman branches on orders', () => {
    expect(sql).toContain("current_user_role() = 'retailer' and retailer_id = auth.uid() and collected_by is null");
    expect(sql).toContain('is_retailer_assigned_to_current_salesman(retailer_id)');
    expect(sql).toContain("current_user_role() = 'salesman'\n      and collected_by = auth.uid()");
  });

  it('preserves visits owner access and scopes the staff branch by retailer area', () => {
    expect(sql).toContain('salesman_id = auth.uid()');
    // 0014's three operation-specific policies are retired (the old read
    // policy grants network-wide staff access) and replaced by scoped
    // read/insert/update policies that keep the salesman-assignment guard.
    for (const stale of ['visits_owner_or_staff_read', 'visits_assigned_salesman_insert', 'visits_assigned_salesman_update']) {
      expect(sql).toContain(`drop policy if exists "${stale}" on visits`);
    }
    for (const fresh of ['visits_scoped_read', 'visits_scoped_insert', 'visits_scoped_update']) {
      expect(sql).toContain(`create policy "${fresh}" on visits`);
    }
    const insertPolicy = sql.match(/create policy "visits_scoped_insert"[\s\S]*?;/)?.[0] ?? '';
    expect(insertPolicy).toContain('is_retailer_assigned_to_current_salesman(retailer_id)');
    expect(insertPolicy).toContain('is_retailer_area_assigned_to_current_staff(retailer_id)');
  });
});

describe('0037 closes the areas/warehouses RLS gap', () => {
  it('enables RLS on both tables with authenticated read and admin write', () => {
    expect(sql).toContain('alter table areas enable row level security');
    expect(sql).toContain('alter table warehouses enable row level security');
    expect(sql.match(/auth\.uid\(\) is not null/g)?.length).toBe(2);
    // areas_admin_write + warehouses_admin_write + routes_staff_write (now admin-only).
    expect(sql.match(/for insert with check \(is_admin_or_above\(\)\)/g)?.length).toBe(3);
  });
});
