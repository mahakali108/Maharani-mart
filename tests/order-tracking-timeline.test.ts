/**
 * Order tracking timeline — stage labels + estimated delivery date.
 *
 * Locks in:
 *   1. The five stages read as the retailer journey: Order placed → Admin
 *      confirmed → Warehouse packed → Dispatched → Delivered
 *   2. The estimated delivery date is shown ONLY when real data exists
 *      (company-configured estimate) — never invented per order
 *   3. Actual dispatch/delivery stamps from the order record are surfaced
 *   4. Cancelled/returned orders keep the event list (no fake progress)
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(__dirname, '..');
const read = (rel: string) => readFileSync(join(root, rel), 'utf8');

const timeline = read('components/retailer/order-status-timeline.tsx');
const orderDetail = read('app/retailer/orders/[id]/page.tsx');

describe('timeline stages', () => {
  it('labels the five stages with the retailer-facing wording', () => {
    expect(timeline).toContain("label: 'Order placed'");
    expect(timeline).toContain("label: 'Admin confirmed'");
    expect(timeline).toContain("label: 'Warehouse packed'");
    expect(timeline).toContain("label: 'Dispatched'");
    expect(timeline).toContain("label: 'Delivered'");
  });

  it('still renders the full history list for cancelled/returned orders', () => {
    expect(timeline).toContain('Order {label.toLowerCase()}');
    expect(timeline).toContain('See the recorded order events below.');
  });
});

describe('estimated delivery + actuals', () => {
  it('accepts an optional estimate prop and only renders it when provided', () => {
    expect(timeline).toContain('estimate?: { label: string; value: string } | null');
    expect(timeline).toContain('{estimate ? (');
  });

  it('surfaces actual dispatch/delivery stamps from the order record', () => {
    expect(timeline).toContain('actuals?: { dispatchedAt: TimestampInput; deliveredAt: TimestampInput } | null');
    expect(timeline).toContain('Dispatched:');
    expect(timeline).toContain('Delivered:');
  });
});

describe('order detail wiring', () => {
  it('reads the configured company estimate — nothing else feeds the ETA', () => {
    expect(orderDetail).toContain('process.env.COMPANY_DELIVERY_ESTIMATE');
    expect(orderDetail).toContain("deliveryEstimate ? { label: 'company service estimate', value: deliveryEstimate } : null");
  });

  it('selects the real dispatched_at / delivered_at columns from orders', () => {
    expect(orderDetail).toContain('dispatched_at, delivered_at');
    expect(orderDetail).toMatch(/actuals=\{\{ dispatchedAt: order\.dispatched_at, deliveredAt: order\.delivered_at \}\}/);
  });
});
