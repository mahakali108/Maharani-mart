/**
 * Product detail page — compact redesign guards.
 *
 * Locks in the compact layout without touching business logic:
 *   1. Headline price honesty: the big per-piece rate is the rate that
 *      applies RIGHT NOW (cart qty, else MOQ); the best-tier rate is
 *      labelled separately and can never read as the current price.
 *   2. No repetition: each fact (price, MRP, savings, slabs, pack, MOQ, GST)
 *      is shown once — a single slab table, a single Buy now, compact chips.
 *   3. Single-pack products get a compact "Pack" line, not a size wall;
 *      multi-pack products keep URL-driven size cards + view-all.
 *   4. Delivery is two lines; product details are collapsed until tapped.
 *   5. Quantity, tiers, MOQ, cart and sticky-bar behaviour are unchanged —
 *      same engine, same actions, same safe-area bar.
 *
 * Same repo style as the other PDP suites: pure-function tests for the
 * pricing plus source-level guards on the exact JSX wiring.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { calculateRetailerPiecePrice } from '@/lib/retailer/retailer-pricing';
import { suggestedQuantities, tierRangeLabel, type PricingTier } from '@/lib/retailer/case-pricing';

const root = join(__dirname, '..');
const read = (rel: string) => readFileSync(join(root, rel), 'utf8');

const page = read('app/retailer/catalog/[id]/page.tsx');
const selector = read('components/retailer/pack-selector.tsx');
const switcher = read('components/retailer/variant-switcher.tsx');

// Garnier-like slab fixture from the redesign brief:
// 1–6 → 97.58, 7–12 → 97.00, 13–50 → 96.00, 51–71 → 95.00 (max is exclusive).
const SLABS: PricingTier[] = [
  { id: 's1', min_quantity: 1, max_quantity: 7, price_per_piece: 97.58, rule_type: 'loose' },
  { id: 's2', min_quantity: 7, max_quantity: 13, price_per_piece: 97.0, rule_type: 'loose' },
  { id: 's3', min_quantity: 13, max_quantity: 51, price_per_piece: 96.0, rule_type: 'loose' },
  { id: 's4', min_quantity: 51, max_quantity: 72, price_per_piece: 95.0, rule_type: 'loose' },
];

function price(qty: number, moq = 1) {
  return calculateRetailerPiecePrice({
    quantity: qty,
    unitsPerCase: 72,
    casePrice: 0,
    tiers: SLABS,
    gstPercent: 18,
    moq,
    derivedPiecePrice: 97.58,
  });
}

// ---------------------------------------------------------------------------
// 1. Correct selected-tier price (the §14 honesty rule)
// ---------------------------------------------------------------------------

describe('compact redesign: honest headline price', () => {
  it('prices quantity 2 at the 1–6 tier rate, not the best-tier rate', () => {
    const at2 = price(2);
    expect(at2.orderable).toBe(true);
    expect(at2.unitPrice).toBe(97.58);
    expect(at2.lineTotal).toBeCloseTo(195.16, 2);
    expect(at2.tier?.min_quantity).toBe(1);
    // GST stays extracted from the inclusive total — never added on top.
    expect(at2.subtotal + at2.gst).toBeCloseTo(at2.lineTotal, 2);
  });

  it('crosses slab boundaries and extends the deepest slab past 71 pcs', () => {
    expect(price(6).unitPrice).toBe(97.58);
    expect(price(7).unitPrice).toBe(97.0);
    expect(price(13).unitPrice).toBe(96.0);
    expect(price(51).unitPrice).toBe(95.0);
    expect(price(71).unitPrice).toBe(95.0);
    expect(price(200).unitPrice).toBe(95.0);
    expect(tierRangeLabel(1, 7)).toBe('1–6 pcs');
    expect(tierRangeLabel(51, 72)).toBe('51–71 pcs');
  });

  it('the page headlines the applicable rate (cart qty, else MOQ) via the engine', () => {
    // Headline quantity = max(MOQ, pieces already in the cart for the pack).
    expect(page).toContain('const headlineQty = selectedEnriched');
    expect(page).toContain('Math.max(selectedEnriched.moq');
    expect(page).toContain('cartItemByPackId.get(selectedEnriched.id)?.quantity');
    // Priced by the canonical engine — no hand-rolled money math.
    expect(page).toContain('const headlinePricing =');
    expect(page).toContain('quantity: headlineQty,');
    // The big number is the applicable rate, with its quantity + tier shown.
    expect(page).toContain('{formatInr(headlineUnit)}');
    expect(page).toContain('for {headlineQty} pc');
    expect(page).toContain('· Tier ${headlineTierLabel}');
  });

  it('the best-tier rate is labelled separately, only when it beats the headline', () => {
    expect(page).toContain('Best price {formatInr(selectedPiecePrice)}/pc at {selectedTierLabel}');
    expect(page).toContain('const showBestRate =');
    expect(page).toContain('selectedPiecePrice < headlineUnit');
    // Savings/discount stay "up to" claims against the best rate — consistent
    // with the gallery badge, which still uses the best-rate computation.
    expect(page).toContain('up to {discount}% off');
    expect(page).toContain('You save up to {formatInr(saveAmount)} per piece vs MRP');
    expect(page).toContain('calcDiscountPercent(selectedPack?.mrp, selectedPiecePrice)');
  });
});

// ---------------------------------------------------------------------------
// 2. Each fact shown once
// ---------------------------------------------------------------------------

describe('compact redesign: no repeated information', () => {
  it('renders exactly one slab table on the page (none in the selector)', () => {
    expect(page.match(/<RetailerPriceSchedule/g)).toHaveLength(1);
    expect(selector).not.toContain('RetailerPriceSchedule');
    // The quantity card still re-prices live through the engine breakdown.
    expect(selector).toContain('<RetailerLineBreakdown className="mt-2.5" pricing={pricing} />');
  });

  it('keeps exactly one Buy now CTA on the purchase card', () => {
    expect(selector).toContain('onClick={() => handleBuyPack(pack)}');
    expect(selector.match(/Buy now/g)).toHaveLength(1);
    expect(selector).not.toContain('Buy now — 1-click checkout');
  });

  it('drops the repeated debug line and the wholesale-highlights wall', () => {
    expect(page).not.toContain('Secondary line: show canonical source');
    expect(page).not.toContain('Wholesale highlights');
    // The facts survive as one compact chip row.
    expect(page).toContain('aria-label="Order essentials"');
    expect(page).toContain('MOQ {selectedPack.moq} pc');
    expect(page).toContain('GST {product.gst_percent}%');
    expect(page).toContain('Sold by piece');
  });

  it('keeps the slabs reassurance line verbatim (server-rule wording)', () => {
    expect(page).toContain('never compulsory');
  });
});

// ---------------------------------------------------------------------------
// 3. Single-pack vs multi-pack products
// ---------------------------------------------------------------------------

describe('compact redesign: single-pack and multi-pack products', () => {
  it('a single pack renders a compact Pack line, not a Choose-size wall', () => {
    expect(switcher).toContain('model.variants.length === 1');
    expect(switcher).toContain('>Pack</p>');
    expect(switcher).toContain('{only.label}');
  });

  it('multiple packs keep URL-driven size cards with per-size prices + view-all', () => {
    expect(switcher).toContain('Choose size');
    expect(switcher).toContain('href={variant.href}');
    expect(switcher).toContain('Slabs ${pricing.tierSummary}');
    expect(switcher).toContain('Single rate per piece');
    expect(switcher).toContain('View all {model.variants.length} sizes');
  });

  it('the selector gives the selected pack the full card and others slim rows', () => {
    expect(selector).toContain('const effectiveSelectedId');
    expect(selector).toContain('pack.id === effectiveSelectedId');
    // Slim rows still order their own size: stepper + add/update/remove.
    expect(selector).toContain('Add pieces');
    expect(selector).toContain('Update · {formatInr(pricing.lineTotal)}');
    expect(selector).toContain('Add to cart · {formatInr(pricing.lineTotal)}');
    // Multi-size batch ordering still works.
    expect(selector).toContain('Add all selected');
  });
});

// ---------------------------------------------------------------------------
// 4. Quantity, tiers, MOQ, cart behaviour unchanged
// ---------------------------------------------------------------------------

describe('compact redesign: ordering behaviour unchanged', () => {
  it('quick quantities come from the engine suggestions — never hardcoded', () => {
    expect(selector).toContain('suggestedQuantities({');
    expect(selector).toContain('aria-label={`Set quantity to ${value} pieces`}');
    // Tier boundaries surface as suggestions for the slab fixture.
    const suggestions = suggestedQuantities({ unitsPerCase: 72, moq: 1, tiers: SLABS });
    expect(suggestions).toContain(1);
    expect(suggestions).toContain(71); // top of the deepest slab
    expect(suggestions.length).toBeLessThanOrEqual(6);
  });

  it('existing cart quantities show as In-cart chips and drive the headline', () => {
    expect(selector).toContain('In cart: {inCart?.quantity} pcs');
    expect(selector).toContain('In cart · {formatInr(pricing.lineTotal)}');
    expect(page).toContain('cartItemByPackId.get(selectedEnriched.id)?.quantity');
  });

  it('below-MOQ quantities are still rejected with the server message', () => {
    const below = price(2, 5);
    expect(below.orderable).toBe(false);
    expect(below.message).toMatch(/minimum order quantity/i);
    expect(selector).toContain('qty > 0 && qty < pack.moq');
    expect(selector).toContain('Minimum order quantity is {pack.moq}');
  });

  it('client still submits only (packId, pieces); server stays authoritative', () => {
    expect(selector).toContain('addToCartAction(pack.id, qty)');
    expect(selector).toContain('updateCartQuantityAction(inCart.cartItemId, qty)');
    expect(selector).toContain('await buyNowAction(pack.id, qty)');
    expect(selector).not.toContain('calculateCaseLoosePrice');
  });
});

// ---------------------------------------------------------------------------
// 5. Delivery, details, mobile layout, sticky bar
// ---------------------------------------------------------------------------

describe('compact redesign: delivery, details, layout', () => {
  it('delivery is two compact lines without exposing warehouse details', () => {
    expect(page).toContain('aria-label="Delivery information"');
    expect(page).toContain('Typical delivery:');
    expect(page).toContain('Maharani Traders');
    expect(page).toContain('dispatch');
    expect(page).not.toContain('Direct from warehouse');
    expect(page).not.toContain('MOQ protected');
    expect(page).not.toContain('GST on every invoice');
  });

  it('product details are collapsed until tapped, with the same real data', () => {
    expect(page).toContain('<details');
    expect(page).toContain('>Product details<');
    expect(page).toContain('HSN code');
    expect(page).toContain('EAN / Barcode');
    expect(page).toContain('Min order (MOQ)');
    expect(page).toContain('product.hsn_code ??');
  });

  it('keeps the mobile-first layout guards (no overflow, 320px safe)', () => {
    expect(page).toContain('grid-cols-1');
    expect(page).toContain('overflow-x-hidden');
    expect(page).toContain('min-w-0');
  });

  it('keeps the single sticky purchase bar above the bottom nav', () => {
    const fixedBars =
      selector.match(/fixed inset-x-0 bottom-\[calc\(4\.25rem\+env\(safe-area-inset-bottom\)\)\]/g) ?? [];
    expect(fixedBars).toHaveLength(1);
    expect(selector).toContain('aria-label="Current cart summary"');
    expect(selector).toContain('View Cart');
    expect(page).not.toContain('fixed inset-x-0');
  });
});
