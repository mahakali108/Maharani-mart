import { describe, expect, it } from 'vitest';
import {
  ORDER_STATUSES,
  allowedTransitionsFrom,
  canTransitionOrderStatus,
  describeTransitionError,
  isOrderStatus,
  isTerminalOrderStatus,
} from '@/lib/orders/state-machine';

describe('order status state machine', () => {
  it('covers exactly the eight real statuses', () => {
    expect(ORDER_STATUSES).toEqual([
      'pending',
      'confirmed',
      'processing',
      'packed',
      'dispatched',
      'delivered',
      'cancelled',
      'returned',
    ]);
  });

  it('allows the happy path end to end', () => {
    expect(canTransitionOrderStatus('pending', 'confirmed')).toBe(true);
    expect(canTransitionOrderStatus('confirmed', 'processing')).toBe(true);
    expect(canTransitionOrderStatus('processing', 'packed')).toBe(true);
    expect(canTransitionOrderStatus('packed', 'dispatched')).toBe(true);
    expect(canTransitionOrderStatus('dispatched', 'delivered')).toBe(true);
  });

  it('allows dispatch from every fulfilment state the FEFO RPC accepts', () => {
    expect(canTransitionOrderStatus('confirmed', 'dispatched')).toBe(true);
    expect(canTransitionOrderStatus('processing', 'dispatched')).toBe(true);
    expect(canTransitionOrderStatus('packed', 'dispatched')).toBe(true);
  });

  it('allows cancellation only before dispatch', () => {
    expect(canTransitionOrderStatus('pending', 'cancelled')).toBe(true);
    expect(canTransitionOrderStatus('confirmed', 'cancelled')).toBe(true);
    expect(canTransitionOrderStatus('processing', 'cancelled')).toBe(true);
    expect(canTransitionOrderStatus('packed', 'cancelled')).toBe(true);
    expect(canTransitionOrderStatus('dispatched', 'cancelled')).toBe(false);
    expect(canTransitionOrderStatus('delivered', 'cancelled')).toBe(false);
  });

  it('allows failed-delivery re-attempt (D3) and return-to-warehouse after dispatch', () => {
    expect(canTransitionOrderStatus('dispatched', 'processing')).toBe(true);
    expect(canTransitionOrderStatus('dispatched', 'returned')).toBe(true);
    expect(canTransitionOrderStatus('delivered', 'returned')).toBe(true);
  });

  it('rejects skips, reversals and revivals', () => {
    expect(canTransitionOrderStatus('pending', 'delivered')).toBe(false);
    expect(canTransitionOrderStatus('pending', 'dispatched')).toBe(false);
    expect(canTransitionOrderStatus('confirmed', 'packed')).toBe(false);
    expect(canTransitionOrderStatus('delivered', 'processing')).toBe(false);
    expect(canTransitionOrderStatus('cancelled', 'pending')).toBe(false);
    expect(canTransitionOrderStatus('cancelled', 'confirmed')).toBe(false);
    expect(canTransitionOrderStatus('returned', 'delivered')).toBe(false);
  });

  it('treats a same-status update as a legal no-op', () => {
    for (const status of ORDER_STATUSES) {
      expect(canTransitionOrderStatus(status, status)).toBe(true);
    }
  });

  it('marks cancelled and returned as terminal', () => {
    expect(isTerminalOrderStatus('cancelled')).toBe(true);
    expect(isTerminalOrderStatus('returned')).toBe(true);
    expect(isTerminalOrderStatus('pending')).toBe(false);
    expect(isTerminalOrderStatus('dispatched')).toBe(false);
  });

  it('explains invalid transitions with the legal options', () => {
    expect(describeTransitionError('pending', 'delivered')).toContain('confirmed, cancelled');
    expect(describeTransitionError('cancelled', 'pending')).toContain('can no longer change status');
    expect(describeTransitionError('confirmed', 'confirmed')).toBe('');
  });

  it('validates status values', () => {
    expect(isOrderStatus('pending')).toBe(true);
    expect(isOrderStatus('shipped')).toBe(false);
    expect(isOrderStatus(null)).toBe(false);
    expect(isOrderStatus(42)).toBe(false);
  });

  it('never invents transitions for unknown statuses', () => {
    expect(allowedTransitionsFrom('pending')).not.toContain('returned' as never);
    // Exhaustive map: every status has an entry.
    for (const status of ORDER_STATUSES) {
      expect(Array.isArray(allowedTransitionsFrom(status))).toBe(true);
    }
  });
});
