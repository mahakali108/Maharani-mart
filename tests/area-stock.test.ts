/**
 * Area stock view (migration 0041) and Phase 3 warehouse surfaces — static
 * verification following the established migration-assertion pattern.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '..');
const sql = readFileSync(join(ROOT, 'supabase/migrations/0041_area_stock_view.sql'), 'utf8');

const stripComments = (text: string) =>
  text
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('--'))
    .join('\n');

describe('0041 area stock view', () => {
  it('is additive and re-runnable (create or replace only)', () => {
    const body = stripComments(sql).toLowerCase();
    expect(body).toContain('create or replace view inventory_area_totals');
    expect(body).not.toMatch(/drop table\b/);
    expect(body).not.toMatch(/drop view\b/);
    expect(body).not.toMatch(/alter table\b/);
    expect(body).not.toMatch(/\bdelete from\b/);
    expect(body).not.toMatch(/\binsert into\b/);
  });

  it('runs with the caller privileges so inventory RLS applies', () => {
    expect(sql).toContain('security_invoker = true');
  });

  it('aggregates across ACTIVE warehouses of the area only', () => {
    expect(sql).toContain('join warehouses w on w.area_id = a.id and w.is_active');
    expect(sql).toContain('group by a.id, a.name, ist.product_id, p.name, p.sku_code');
  });

  it('exposes on-hand and reserved totals per product per area', () => {
    expect(sql).toContain('sum(ist.quantity)          as quantity_on_hand');
    expect(sql).toContain('sum(ist.reserved_quantity) as quantity_reserved');
  });
});

describe('Phase 3 pick/pack wiring', () => {
  const action = readFileSync(join(ROOT, 'lib/staff/pick-pack-actions.ts'), 'utf8');
  const stateMachine = readFileSync(join(ROOT, 'lib/orders/state-machine.ts'), 'utf8');

  it('validates transitions through the shared state machine', () => {
    expect(action).toContain("from '@/lib/orders/state-machine'");
    expect(action).toContain('canTransitionOrderStatus');
  });

  it('advances exactly confirmed → processing → packed', () => {
    expect(action).toContain("advanceFulfilmentStatus(orderId, 'confirmed', 'processing'");
    expect(action).toContain("advanceFulfilmentStatus(orderId, 'processing', 'packed'");
  });

  it('guards the flip atomically against concurrent changes', () => {
    expect(action).toContain(".eq('status', expectedFrom)");
  });

  it('keeps the transition table as the single source of truth', () => {
    expect(stateMachine).toContain('pending: [\'confirmed\', \'cancelled\']');
    expect(stateMachine).toContain('dispatched: [\'delivered\', \'processing\', \'returned\']');
  });
});
