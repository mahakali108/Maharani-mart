/**
 * Delivery split invariant (0046 / finding F1) — static verification that
 * dispatch snapshots are storable (0/0/0 pre-completion, never faked) while
 * terminal states still require the exact split, and that every app writer
 * upholds the contract. Live row behaviour is covered by
 * supabase/smoke-test.sql §E against a real project.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  allowedDeliveryTransitionsFrom,
  canTransitionDeliveryStatus,
  DELIVERY_STATUSES,
} from '@/lib/delivery/state-machine';

const ROOT = join(__dirname, '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

const sql46 = read('supabase/migrations/0046_delivery_split_terminal_states.sql');
const dispatchSrc = read('lib/staff/dispatch-actions.ts');
const deliverySrc = read('lib/delivery/delivery-actions.ts');

const stripComments = (text: string) =>
  text
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('--'))
    .join('\n');

const TERMINAL_SPLIT_STATES = [
  'delivered',
  'partially_delivered',
  'failed',
  'returned_to_warehouse',
] as const;

const lineTriggerFn = sql46.match(
  /create or replace function enforce_delivery_split_for_terminal_states\(\)[\s\S]*?language plpgsql;/
)?.[0];
const parentTriggerFn = sql46.match(
  /create or replace function enforce_delivery_lines_complete_on_terminal\(\)[\s\S]*?language plpgsql;/
)?.[0];

describe('0046 pre-completion rule: dispatch snapshots are storable', () => {
  it('relaxes the row check to <= so 0/0/0 dispatch snapshots pass', () => {
    expect(sql46).toContain('drop constraint if exists order_delivery_items_split');
    expect(sql46).toContain(
      'check (quantity_delivered + quantity_missing + quantity_damaged <= quantity_ordered)'
    );
  });

  it('dispatch inserts snapshots WITHOUT faked delivered counts', () => {
    expect(dispatchSrc).toContain('quantity_ordered: item.quantity_pieces ?? item.quantity,');
    // The snapshot carries ONLY identity + ordered quantity — no
    // delivered/missing/damaged keys may appear between construction and insert.
    const snapshotBlock = dispatchSrc.slice(
      dispatchSrc.indexOf('const itemSnapshots'),
      dispatchSrc.indexOf('.insert(itemSnapshots')
    );
    expect(snapshotBlock.length).toBeGreaterThan(0);
    expect(snapshotBlock).not.toContain('quantity_delivered');
    expect(snapshotBlock).not.toContain('quantity_missing');
    expect(snapshotBlock).not.toContain('quantity_damaged');
  });

  it('re-dispatch reset returns the task to non-terminal before re-snapshotting', () => {
    // The reset only touches failed tasks and flips them back to assigned
    // (non-terminal), so the fresh 0/0/0 snapshot is legal.
    expect(dispatchSrc).toContain(".eq('delivery_status', 'failed')");
    expect(dispatchSrc).toContain("delivery_status: 'assigned'");
  });
});

describe('0046 terminal rule: the split must balance exactly', () => {
  it('line trigger requires the exact split in exactly the four terminal states', () => {
    expect(lineTriggerFn).toBeDefined();
    for (const state of TERMINAL_SPLIT_STATES) {
      expect(lineTriggerFn).toContain(`'${state}'`);
    }
    const code = stripComments(lineTriggerFn ?? '');
    expect(code).not.toContain("'assigned'");
    expect(code).not.toContain("'in_progress'");
    expect(lineTriggerFn).toContain('DELIVERY_SPLIT_INCOMPLETE');
    expect(sql46).toContain(
      'drop trigger if exists trg_enforce_delivery_split on order_delivery_items'
    );
  });

  it('parent trigger gates terminal entry on balanced lines and rejects born-terminal tasks', () => {
    expect(parentTriggerFn).toBeDefined();
    for (const state of TERMINAL_SPLIT_STATES) {
      expect(parentTriggerFn).toContain(`'${state}'`);
    }
    const code = stripComments(parentTriggerFn ?? '');
    expect(code).not.toContain("'assigned'");
    expect(code).not.toContain("'in_progress'");
    expect(parentTriggerFn).toContain('DELIVERY_LINES_INCOMPLETE');
    expect(parentTriggerFn).toContain('DELIVERY_BORN_TERMINAL');
    // Fires on INSERT (born-terminal rejection) as well as status updates.
    expect(sql46).toContain('before insert or update of delivery_status on order_deliveries');
    expect(sql46).toContain(
      'drop trigger if exists trg_enforce_delivery_lines_complete on order_deliveries'
    );
  });

  it('completion writes full splits line-by-line BEFORE flipping the parent', () => {
    expect(deliverySrc).toContain('delivered + missing + damaged !== line.quantity_ordered');
    const linesWrite = deliverySrc.indexOf('quantity_delivered: delivered,');
    const statusFlip = deliverySrc.indexOf('delivery_status: finalStatus,');
    expect(linesWrite).toBeGreaterThan(-1);
    expect(statusFlip).toBeGreaterThan(linesWrite);
  });

  it('fail records every line as fully missing BEFORE flipping to failed', () => {
    const failFn = deliverySrc.slice(deliverySrc.indexOf('recordFailedDeliveryAction'));
    const bounded = failFn.slice(0, failFn.indexOf('recordReturnToWarehouseAction'));
    expect(bounded).toContain('quantity_missing: line.quantity_ordered');
    expect(bounded.indexOf('quantity_missing: line.quantity_ordered')).toBeLessThan(
      bounded.indexOf("delivery_status: 'failed'")
    );
  });

  it('RTO stays reachable only from already-balanced delivered/partially_delivered', () => {
    expect(canTransitionDeliveryStatus('delivered', 'returned_to_warehouse')).toBe(true);
    expect(canTransitionDeliveryStatus('partially_delivered', 'returned_to_warehouse')).toBe(true);
    expect(canTransitionDeliveryStatus('assigned', 'returned_to_warehouse')).toBe(false);
    expect(canTransitionDeliveryStatus('failed', 'returned_to_warehouse')).toBe(false);
    const rtoFn = deliverySrc.slice(deliverySrc.indexOf('recordReturnToWarehouseAction'));
    expect(rtoFn).toContain(".in('delivery_status', ['delivered', 'partially_delivered'])");
  });
});

describe('partial, failed and RTO flows stay correct', () => {
  it('partial delivery is a terminal split state reachable from open tasks', () => {
    expect(canTransitionDeliveryStatus('assigned', 'partially_delivered')).toBe(true);
    expect(canTransitionDeliveryStatus('in_progress', 'partially_delivered')).toBe(true);
    expect(deliverySrc).toContain(
      "settlement.fullyDelivered ? 'delivered' : 'partially_delivered'"
    );
  });

  it('failed re-opens only via failed -> assigned', () => {
    expect(allowedDeliveryTransitionsFrom('failed')).toEqual(['assigned']);
    expect(canTransitionDeliveryStatus('failed', 'delivered')).toBe(false);
    expect(canTransitionDeliveryStatus('failed', 'partially_delivered')).toBe(false);
  });

  it('returned_to_warehouse is terminal', () => {
    expect(allowedDeliveryTransitionsFrom('returned_to_warehouse')).toEqual([]);
    for (const state of DELIVERY_STATUSES) {
      if (state === 'returned_to_warehouse') continue;
      expect(canTransitionDeliveryStatus('returned_to_warehouse', state)).toBe(false);
    }
  });

  it('every terminal split state is reachable in the state machine', () => {
    for (const state of TERMINAL_SPLIT_STATES) {
      const reachable = DELIVERY_STATUSES.some(
        (from) => from !== state && canTransitionDeliveryStatus(from, state)
      );
      expect(reachable).toBe(true);
    }
  });
});
