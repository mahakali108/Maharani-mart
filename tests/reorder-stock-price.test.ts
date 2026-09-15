/**
 * Reorder upgrades — current stock visibility + previous-vs-current price.
 *
 * Locks in the promise on the reorder screen:
 *   1. Stock is re-validated from the sanctioned availability RPC (never a
 *      warehouse number, never invented)
 *   2. Unavailable lines (inactive product/pack) stay excluded and locked
 *   3. Changed prices are shown explicitly (was ₹X / now ₹Y) from stored
 *      previous-order data + the current engine — never a silent drift
 *   4. The submit path still re-runs the full server validation (price, MOQ,
 *      active) so the display can never be the only gate
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { availabilityBadge, isOutOfStock, normalizeAvailabilityState } from '@/lib/retailer/availability';

const root = join(__dirname, '..');
const read = (rel: string) => readFileSync(join(root, rel), 'utf8');

const reorderPage = read('app/retailer/orders/[id]/reorder/page.tsx');
const reorderForm = read('components/retailer/reorder-form.tsx');
const orderActions = read('lib/retailer/order-actions.ts');

describe('availability display mapping (shared, sanctioned)', () => {
  it('normalises only known states; everything else is unknown', () => {
    expect(normalizeAvailabilityState('in_stock')).toBe('in_stock');
    expect(normalizeAvailabilityState('low_stock')).toBe('low_stock');
    expect(normalizeAvailabilityState('out_of_stock')).toBe('out_of_stock');
    expect(normalizeAvailabilityState('999999')).toBe('unknown');
    expect(normalizeAvailabilityState(null)).toBe('unknown');
  });

  it('unknown never claims availability', () => {
    expect(availabilityBadge('unknown')).toBeNull();
    expect(isOutOfStock('unknown')).toBe(false);
  });

  it('out-of-stock is unambiguous', () => {
    expect(isOutOfStock('out_of_stock')).toBe(true);
    expect(availabilityBadge('out_of_stock')?.label).toMatch(/Unavailable/i);
    expect(availabilityBadge('in_stock')?.label).toMatch(/Available/i);
  });
});

describe('reorder page guards', () => {
  it('fetches CURRENT stock via the sanctioned retailer availability RPC', () => {
    expect(reorderPage).toContain('loadCatalogAvailability');
    expect(reorderPage).toContain('availability:');
  });

  it('keeps the stored previous price available for change display', () => {
    expect(reorderPage).toContain('unit_price, line_total');
    expect(reorderPage).toContain('previousPiecePrice');
    // The previous piece price is derived from stored totals only.
    expect(reorderPage).toMatch(/total \/ quantity\.pieces/);
  });

  it('still flags inactive product/pack lines as unavailable', () => {
    expect(reorderPage).toMatch(/unavailable = !pack\.is_active \|\| !product\?\.is_active/);
  });

  it('still scopes everything to the caller\'s own order', () => {
    expect(reorderPage).toMatch(/eq\('id', params\.id\)[\s\S]*eq\('retailer_id', user\.id\)/);
  });

  it('tells the retailer current terms apply (no reuse of old pricing)', () => {
    expect(reorderPage).toContain('Current terms apply');
    expect(reorderPage).toContain('Original order pricing is never reused');
  });
});

describe('reorder form guards', () => {
  it('renders the stock badge from the shared availability helper', () => {
    expect(reorderForm).toContain('availabilityBadge');
    expect(reorderForm).toContain('stockBadge');
  });

  it('shows an explicit price-change indicator with both prices', () => {
    expect(reorderForm).toContain('Price changed: was ₹');
    expect(reorderForm).toContain('previousPiecePrice');
    // A change is only reported beyond paise rounding noise.
    expect(reorderForm).toMatch(/Math\.abs\(line\.previousPiecePrice - pricing\.unitPrice\) >= 0\.005/);
  });

  it('out-of-stock lines stay orderable with an honest note (stock confirmed at processing)', () => {
    expect(reorderForm).toContain('isOutOfStock');
    expect(reorderForm).toMatch(/Out of stock right now/);
    expect(reorderForm).toMatch(/confirmed when the order is processed/i);
  });

  it('unavailable lines remain disabled (checkbox + quantity)', () => {
    expect(reorderForm).toMatch(/disabled=\{line\.unavailable \|\| isPending\}/);
  });

  it('submits only packId+quantity — the server re-validates price/MOQ/active', () => {
    expect(reorderForm).toContain('addReorderLinesToCartAction');
    expect(orderActions).toContain('validatePackForCart');
    expect(orderActions).toMatch(/quantity < pack\.moq/);
    expect(orderActions).toContain('Only a retailer can reorder into this cart.');
  });
});
