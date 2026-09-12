/**
 * Delivery task state machine (lib/delivery/state-machine.ts, Phase 4).
 */
import { describe, expect, it } from 'vitest';
import {
  DELIVERY_STATUSES,
  allowedDeliveryTransitionsFrom,
  canTransitionDeliveryStatus,
  describeDeliveryTransitionError,
  isCompletedDeliveryStatus,
  isDeliveryStatus,
  isOpenDeliveryStatus,
  isTerminalDeliveryStatus,
} from '@/lib/delivery/state-machine';

describe('delivery statuses', () => {
  it('covers exactly the six task statuses', () => {
    expect(DELIVERY_STATUSES).toEqual([
      'assigned',
      'in_progress',
      'delivered',
      'partially_delivered',
      'failed',
      'returned_to_warehouse',
    ]);
  });

  it('isDeliveryStatus guards unknown values', () => {
    expect(isDeliveryStatus('assigned')).toBe(true);
    expect(isDeliveryStatus('DELIVERED')).toBe(false);
    expect(isDeliveryStatus('shipped')).toBe(false);
    expect(isDeliveryStatus(42)).toBe(false);
    expect(isDeliveryStatus(null)).toBe(false);
  });
});

describe('legal transitions', () => {
  it('assignee starts the task', () => {
    expect(canTransitionDeliveryStatus('assigned', 'in_progress')).toBe(true);
  });

  it('completes from assigned OR in_progress, fully or partially', () => {
    expect(canTransitionDeliveryStatus('assigned', 'delivered')).toBe(true);
    expect(canTransitionDeliveryStatus('assigned', 'partially_delivered')).toBe(true);
    expect(canTransitionDeliveryStatus('in_progress', 'delivered')).toBe(true);
    expect(canTransitionDeliveryStatus('in_progress', 'partially_delivered')).toBe(true);
  });

  it('fails from assigned or in_progress', () => {
    expect(canTransitionDeliveryStatus('assigned', 'failed')).toBe(true);
    expect(canTransitionDeliveryStatus('in_progress', 'failed')).toBe(true);
  });

  it('re-dispatch resets a failed task', () => {
    expect(canTransitionDeliveryStatus('failed', 'assigned')).toBe(true);
  });

  it('delivered / partially delivered may be returned to the warehouse', () => {
    expect(canTransitionDeliveryStatus('delivered', 'returned_to_warehouse')).toBe(true);
    expect(canTransitionDeliveryStatus('partially_delivered', 'returned_to_warehouse')).toBe(true);
  });

  it('same-status updates are legal no-ops', () => {
    for (const status of DELIVERY_STATUSES) {
      expect(canTransitionDeliveryStatus(status, status)).toBe(true);
    }
  });
});

describe('illegal transitions', () => {
  const forbidden: [string, string][] = [
    ['assigned', 'returned_to_warehouse'], // nothing was handed over yet
    ['in_progress', 'assigned'], // cannot un-start
    ['delivered', 'in_progress'],
    ['delivered', 'failed'], // completed goods cannot "fail" — use RTO
    ['partially_delivered', 'failed'],
    ['partially_delivered', 'delivered'], // the record is final; correct via RTO
    ['returned_to_warehouse', 'assigned'],
    ['returned_to_warehouse', 'delivered'],
    ['returned_to_warehouse', 'failed'],
    ['failed', 'delivered'], // must be re-dispatched first
    ['failed', 'partially_delivered'],
    ['failed', 'returned_to_warehouse'],
  ];

  it.each(forbidden)('rejects %s -> %s', (from, to) => {
    expect(canTransitionDeliveryStatus(from as never, to as never)).toBe(false);
  });

  it('returned_to_warehouse is terminal', () => {
    expect(isTerminalDeliveryStatus('returned_to_warehouse')).toBe(true);
    expect(allowedDeliveryTransitionsFrom('returned_to_warehouse')).toEqual([]);
    for (const status of DELIVERY_STATUSES) {
      if (status === 'returned_to_warehouse') continue;
      expect(canTransitionDeliveryStatus('returned_to_warehouse', status)).toBe(false);
    }
  });
});

describe('status groupings', () => {
  it('completed = goods handed over', () => {
    expect(isCompletedDeliveryStatus('delivered')).toBe(true);
    expect(isCompletedDeliveryStatus('partially_delivered')).toBe(true);
    expect(isCompletedDeliveryStatus('assigned')).toBe(false);
    expect(isCompletedDeliveryStatus('failed')).toBe(false);
  });

  it('open = still work for the delivery person', () => {
    expect(isOpenDeliveryStatus('assigned')).toBe(true);
    expect(isOpenDeliveryStatus('in_progress')).toBe(true);
    expect(isOpenDeliveryStatus('failed')).toBe(false);
    expect(isOpenDeliveryStatus('delivered')).toBe(false);
  });
});

describe('error messages', () => {
  it('returns null for legal transitions', () => {
    expect(describeDeliveryTransitionError('assigned', 'in_progress')).toBeNull();
  });

  it('explains illegal transitions with the allowed options', () => {
    const message = describeDeliveryTransitionError('delivered', 'failed');
    expect(message).toContain('delivered');
    expect(message).toContain('failed');
    expect(message).toContain('returned to warehouse');
  });

  it('explains terminal statuses without options', () => {
    const message = describeDeliveryTransitionError('returned_to_warehouse', 'assigned');
    expect(message).toContain('no further changes');
  });
});
