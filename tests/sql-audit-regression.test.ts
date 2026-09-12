/**
 * SQL audit regression suite — every issue found by the from-scratch re-audit
 * of migrations 0037–0045 (Supabase failures on 0037/0043/0045, dispatch
 * breakage, storage policy bugs, smoke-test syntax, money-unit bug).
 *
 * Each block pins the CORRECT state so a future edit that reintroduces any of
 * these bugs fails loudly here instead of in the Supabase SQL Editor.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { can } from '@/lib/permissions/permissions';

const ROOT = join(__dirname, '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

const sql37 = read('supabase/migrations/0037_staff_scope_policies.sql');
const sql43 = read('supabase/migrations/0043_deliveries_module.sql');
const sql44 = read('supabase/migrations/0044_payment_collections.sql');
const sql45 = read('supabase/migrations/0045_delivery_payment_proof_buckets.sql');
const smoke = read('supabase/smoke-test.sql');
const dispatchSrc = read('lib/staff/dispatch-actions.ts');
const deliverySrc = read('lib/delivery/delivery-actions.ts');

// ---------------------------------------------------------------------------
// 0037 — the Supabase failure that cascaded into 0043 and 0045
// ---------------------------------------------------------------------------

describe('0037 uses the real stock_transfers columns (audit: Supabase 42703)', () => {
  it('references source/destination_warehouse_id (0017), never from/to_warehouse_id', () => {
    expect(sql37).toContain('t.source_warehouse_id');
    expect(sql37).toContain('t.destination_warehouse_id');
    expect(sql37).toContain('is_warehouse_assigned_to_current_staff(source_warehouse_id)');
    expect(sql37).toContain('is_warehouse_assigned_to_current_staff(destination_warehouse_id)');
    expect(sql37).not.toContain('from_warehouse_id');
    expect(sql37).not.toContain('to_warehouse_id');
  });

  it('no migration SQL anywhere references the never-existing from/to columns', () => {
    const dir = join(ROOT, 'supabase/migrations');
    for (const file of readdirSync(dir).filter((f) => f.endsWith('.sql'))) {
      const body = read(`supabase/migrations/${file}`);
      expect(body, file).not.toContain('from_warehouse_id');
      expect(body, file).not.toContain('to_warehouse_id');
    }
  });
});

describe('0037 retires every stale broad policy it replaces (audit: RLS OR-survival)', () => {
  it('drops the 0005 areas/warehouses policies, or staff keep write + anon keeps read', () => {
    for (const stale of [
      '"areas_read" on areas',
      '"areas_staff_insert" on areas',
      '"warehouses_read" on warehouses',
      '"warehouses_staff_insert" on warehouses',
      '"warehouses_staff_update" on warehouses',
    ]) {
      expect(sql37).toContain(`drop policy if exists ${stale}`);
    }
  });

  it('replaces (not stacks onto) the 0014 visits policies', () => {
    for (const stale of [
      'visits_owner_or_staff_read',
      'visits_assigned_salesman_insert',
      'visits_assigned_salesman_update',
    ]) {
      expect(sql37).toContain(`drop policy if exists "${stale}" on visits`);
    }
    // No single FOR ALL visits policy: it would let salesmen insert visits
    // for unassigned retailers (0014 forbids that explicitly).
    expect(sql37).not.toMatch(/create policy "visits_owner_or_staff" on visits\s+for all/i);
    for (const fresh of ['visits_scoped_read', 'visits_scoped_insert', 'visits_scoped_update']) {
      expect(sql37).toContain(`create policy "${fresh}" on visits`);
      expect(sql37).toContain(`drop policy if exists "${fresh}" on visits`);
    }
  });

  it('replaces the broad route_customers SELECT policy, not just the writes', () => {
    expect(sql37).toContain('drop policy if exists "route_customers_owner_or_staff" on route_customers');
    const selectPolicy =
      sql37.match(/create policy "route_customers_owner_or_staff"[\s\S]*?;/)?.[0] ?? '';
    expect(selectPolicy).toContain('for select');
    expect(selectPolicy).toContain('is_area_assigned_to_current_staff(r.area_id)');
    expect(selectPolicy).not.toContain('is_staff_or_above()');
  });
});

// ---------------------------------------------------------------------------
// 0043 — dispatch must be able to snapshot zero quantities
// ---------------------------------------------------------------------------

describe('0043 split constraint admits the dispatch pending state (audit: dispatch 23514)', () => {
  it('dispatch inserts quantity_ordered only (delivered/missing/damaged default to 0)', () => {
    const snapshot = dispatchSrc.match(/const itemSnapshots[\s\S]*?;/ )?.[0] ?? '';
    expect(snapshot).toContain('quantity_ordered: item.quantity_pieces ?? item.quantity');
    expect(snapshot).not.toContain('quantity_delivered');
    expect(snapshot).not.toContain('quantity_missing');
    expect(snapshot).not.toContain('quantity_damaged');
  });

  it('the CHECK therefore accepts all-zeros OR the exact split — never bare equality', () => {
    expect(sql43).toContain('quantity_delivered + quantity_missing + quantity_damaged = quantity_ordered');
    expect(sql43).toContain('quantity_delivered = 0 and quantity_missing = 0 and quantity_damaged = 0');
    expect(sql43).not.toContain('check (quantity_delivered + quantity_missing + quantity_damaged = quantity_ordered)');
  });

  it('completion still validates the exact split server-side', () => {
    expect(deliverySrc).toContain('delivered + missing + damaged !== line.quantity_ordered');
  });
});

// ---------------------------------------------------------------------------
// 0044 — collections: admin correction path, one-way money state, ledger link
// ---------------------------------------------------------------------------

describe('0044 collections hardening (audit: app/RLS mismatch + unenforced one-way)', () => {
  it('lets admin+ insert (back-office corrections) while salesmen stay assigned-scoped', () => {
    const policy =
      sql44.match(/create policy "payment_collections_authorized_insert"[\s\S]*?;/)?.[0] ?? '';
    expect(policy).toContain('is_admin_or_above()');
    expect(policy).toContain("current_user_role() = 'salesman'");
    expect(policy).toContain('is_retailer_assigned_to_current_salesman(retailer_id)');
    expect(policy).not.toContain("current_user_role() = 'staff'");
  });

  it('pins every insert to pending (a pre-verified row would skip the ledger credit)', () => {
    const policy =
      sql44.match(/create policy "payment_collections_authorized_insert"[\s\S]*?;/)?.[0] ?? '';
    expect(policy).toContain("status = 'pending'");
  });

  it('enforces pending → verified|rejected with a trigger, and links the ledger row', () => {
    expect(sql44).toContain('enforce_collection_status_oneway');
    expect(sql44).toContain('INVALID_COLLECTION_STATUS_TRANSITION');
    expect(sql44).toContain('payment_collections_ledger_entry_fk');
    expect(sql44).toContain('references retailer_wallet_ledger(id)');
  });
});

// ---------------------------------------------------------------------------
// 0045 — payment folder segments + delivery/salesman read parity
// ---------------------------------------------------------------------------

describe('0045 proof-bucket policies (audit: uuid cast 22P02 + read parity)', () => {
  it('reads the retailer id from folder segment [2] behind the payments/ guard', () => {
    expect(sql45).toContain("(storage.foldername(name))[1] = 'payments'");
    expect(sql45).toContain("(storage.foldername(name))[2] = auth.uid()::text");
    expect(sql45).not.toContain('(storage.foldername(name))[1]::uuid');
  });

  it('casts segment [2] only after a strict-UUID CASE guard (AND order is not guaranteed)', () => {
    expect(sql45).toContain('is_retailer_assigned_to_current_salesman((storage.foldername(name))[2]::uuid)');
    expect(sql45).toContain("^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$");
  });

  it('delivery-proof reads match the delivery-record visibility (assigned salesman included)', () => {
    const readPolicy =
      sql45.match(/create policy "delivery_proofs_bucket_read"[\s\S]*?;\n\n/)?.[0] ?? '';
    expect(readPolicy).toContain('is_retailer_assigned_to_current_salesman(o.retailer_id)');
    expect(readPolicy).toContain('o.collected_by = auth.uid()');
  });
});

// ---------------------------------------------------------------------------
// smoke-test.sql — valid PostgreSQL, editor-safe, honest split test
// ---------------------------------------------------------------------------

describe('smoke-test.sql is valid, editor-safe SQL (audit: 42601 + psql-only metas)', () => {
  it('impersonates via set_config, never via invalid SET x = <expression>', () => {
    expect((smoke.match(/set_config\('request\.jwt\.claims'/g) ?? []).length).toBeGreaterThanOrEqual(6);
    expect(smoke).not.toMatch(/set local request\.jwt\.claims\s*=/);
  });

  it('contains no psql meta-commands outside comments', () => {
    const code = smoke
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('--'))
      .join('\n');
    expect(code).not.toContain('\\echo');
  });

  it('leaves the qty=4 line unsnapshotted so §E tests the CHECK, not the unique key', () => {
    expect(smoke).toContain('oi.quantity = 10');
    expect(smoke).not.toContain('select d.id, oi.id, 10');
  });

  it('still rolls everything back (only completion notices follow ROLLBACK)', () => {
    expect(smoke).toContain('BEGIN;');
    expect(smoke).toContain('ROLLBACK;');
    expect(smoke.lastIndexOf('ROLLBACK;')).toBeGreaterThan(smoke.lastIndexOf('§G'));
    const tail = smoke.slice(smoke.lastIndexOf('ROLLBACK;'));
    expect(tail).not.toMatch(/\b(insert|update|delete|create|alter|drop|select set_config)\b/i);
  });
});

// ---------------------------------------------------------------------------
// Money units — settlement input must be paise, like every other ledger write
// ---------------------------------------------------------------------------

describe('partial-delivery settlement uses paise (audit: 100x under-credit)', () => {
  it('converts order_items.line_total (rupees) before feeding the paise engine', () => {
    expect(deliverySrc).toContain("import { rupeesToPaise } from '@/lib/retailer/wallet'");
    expect(deliverySrc).toContain('lineTotalPaise: rupeesToPaise(value?.line_total ?? 0)');
    expect(deliverySrc).not.toMatch(/lineTotalPaise: value\?\.line_total/);
  });
});

// ---------------------------------------------------------------------------
// Permission matrix matches the 0044 RLS insert policy
// ---------------------------------------------------------------------------

describe('collections.record permission matches 0044 RLS (audit: staff mismatch)', () => {
  it('salesman + admin+ hold it; staff and retailer do not', () => {
    expect(can('salesman', 'collections.record')).toBe(true);
    expect(can('admin', 'collections.record')).toBe(true);
    expect(can('super_admin', 'collections.record')).toBe(true);
    expect(can('staff', 'collections.record')).toBe(false);
    expect(can('retailer', 'collections.record')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Operator tooling probes the END of 0037, not an early helper
// ---------------------------------------------------------------------------

describe('production-validate.sh cannot false-pass a partial 0037 (audit: probe)', () => {
  const script = read('scripts/production-validate.sh');

  it('probes the last 0037 object (final policy), not an early function', () => {
    expect(script).toContain("policyname = 'warehouses_authenticated_read'");
    expect(script).not.toContain("proname = 'is_order_assigned_to_current_staff'");
  });

  it('expects all six Phase 4 triggers and zero stale policies', () => {
    expect(script).toContain('trg_enforce_collection_status_oneway');
    expect(script).toContain('stale 0005/0014 policies remaining');
  });
});
