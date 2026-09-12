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
    const creates = sql.match(/create policy/g)?.length ?? 0;
    const drops = sql.match(/drop policy if exists/g)?.length ?? 0;
    expect(creates).toBeGreaterThan(0);
    expect(drops).toBe(creates);
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
    const visitsPolicy = sql.match(/create policy "visits_owner_or_staff"[\s\S]*?;/)?.[0] ?? '';
    expect(visitsPolicy).toContain('is_retailer_area_assigned_to_current_staff(retailer_id)');
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
