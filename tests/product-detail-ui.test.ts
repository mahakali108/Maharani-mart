/**
 * Retailer product-detail page — UI/UX hardening pass tests.
 *
 * Covers the required behaviour matrix in the repo's established style:
 * pure-function tests for the pricing / variant / cart helpers plus
 * source-level guards so a future edit cannot silently break the
 * security, layout or data-integrity rules of this page.
 *
 * The pages themselves are Next.js Server Components backed by Supabase;
 * this repo has no DOM test harness, so "rendering" is verified through
 * (a) the pure helpers that feed each visual surface and (b) assertions
 * on the exact JSX wiring that binds those surfaces together.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  buildVariantSwitcher,
  formatVariantTierSummary,
  variantGalleryImages,
  type VariantPricingInput,
  type VariantPackBase,
} from '@/lib/retailer/variants';
import { calculateRetailerPiecePrice, pickRetailerPieceTier } from '@/lib/retailer/retailer-pricing';
import { resolveLooseTierSet, round2, type PricingTier } from '@/lib/retailer/case-pricing';
import { calcDiscountPercent, calcSavings } from '@/lib/retailer/format';
import { mergeLinesIntoCart } from '@/lib/retailer/cart-merge';

const root = join(__dirname, '..');
const read = (rel: string) => readFileSync(join(root, rel), 'utf8');

const PRODUCT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const PACK_50G = '11111111-1111-4111-8111-111111111111';
const PACK_100G = '22222222-2222-4222-8222-222222222222';
const PACK_200G = '33333333-3333-4333-8333-333333333333';
const RETAILER_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

// ---------------------------------------------------------------------------
// 1. Product detail rendering — the page wires every required surface
// ---------------------------------------------------------------------------

describe('product detail rendering', () => {
  const page = read('app/retailer/catalog/[id]/page.tsx');

  it('renders breadcrumb, gallery, variant switcher, price schedule and pack selector', () => {
    expect(page).toContain('aria-label="Breadcrumb"');
    expect(page).toContain('<ProductGallery');
    expect(page).toContain('<VariantSwitcher');
    expect(page).toContain('<RetailerPriceSchedule');
    expect(page).toContain('<PackSelector');
  });

  it('keeps the breadcrumb compact and overflow-safe (320px phones)', () => {
    expect(page).toContain('overflow-hidden');
    expect(page).toContain('min-w-0');
    expect(page).toContain('max-w-[34%] truncate');
    expect(page).toContain('min-w-0 flex-1 truncate');
  });

  it('shows the share button and the existing favourite toggle on the image card', () => {
    expect(page).toContain('shareSlot={<ShareButton title={product.name} />}');
    expect(page).toContain('<FavoriteToggle productId={product.id}');
  });

  it('keeps the real search behaviour (existing SearchField with suggestions action)', () => {
    const search = read('components/retailer/search-field.tsx');
    expect(search).toContain('searchSuggestionsAction(query)');
    expect(search).toContain('placeholder="Search products, brands, categories"');
    // The header keeps the real cart / notification / account icon links.
    const shell = read('components/layout/retailer-shell.tsx');
    expect(shell).toContain('<SearchField />');
  });

  it('single-column on mobile, two-column on desktop (gallery left, info right)', () => {
    expect(page).toContain('grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(360px,1.15fr)]');
    // No base grid-cols on that container → one column below lg.
    expect(page).not.toMatch(/grid items-start gap-5 grid-cols-/);
  });
});

// ---------------------------------------------------------------------------
// 2. Variant selection — URL-driven, server-resolved, per-variant
// ---------------------------------------------------------------------------

describe('variant selection', () => {
  const page = read('app/retailer/catalog/[id]/page.tsx');

  it('pins the selected variant from the URL and feeds it to switcher + pack selector', () => {
    expect(page).toContain('requestedPackId ? rawPacks.find((pack) => pack.id === requestedPackId)');
    expect(page).toContain('buildVariantSwitcher(rawPacks, selectedPack?.id ?? null, variantPricing)');
    expect(page).toContain('selectedPackId={selectedPack?.id ?? null}');
  });

  it('marks exactly the URL-selected variant and links each card to its own route', () => {
    const bases: VariantPackBase[] = [
      { id: PACK_50G, pack_name: '50g', is_active: true, sort_order: 0 },
      { id: PACK_100G, pack_name: '100g', is_active: true, sort_order: 1 },
    ];
    const model = buildVariantSwitcher(bases, PACK_100G);
    expect(model.variants.filter((v) => v.isSelected).map((v) => v.label)).toEqual(['100g']);
    expect(model.variants[1]?.href).toBe(`/retailer/catalog/${PACK_100G}`);
  });
});

// ---------------------------------------------------------------------------
// 3. Variant image fallback — variant image first, parent gallery behind
// ---------------------------------------------------------------------------

describe('variant image fallback', () => {
  it('uses the variant image first and keeps the parent gallery as fallback', () => {
    const parent = [
      { id: 'img-1', image_url: '/uploads/parent-1.webp' },
      { id: 'img-2', image_url: '/uploads/parent-2.webp' },
    ];
    const withVariantImage = variantGalleryImages({ id: PACK_100G, image_url: '/uploads/100g.webp' }, parent);
    expect(withVariantImage[0]?.image_url).toBe('/uploads/100g.webp');
    expect(withVariantImage).toHaveLength(3);

    const withoutVariantImage = variantGalleryImages({ id: PACK_200G, image_url: null }, parent);
    expect(withoutVariantImage.map((image) => image.image_url)).toEqual([
      '/uploads/parent-1.webp',
      '/uploads/parent-2.webp',
    ]);
    expect(variantGalleryImages({ id: PACK_200G, image_url: null }, [])).toEqual([]);
  });

  it('the page feeds the SELECTED pack into the gallery', () => {
    const page = read('app/retailer/catalog/[id]/page.tsx');
    // Universal gallery: selected variant gallery takes priority, fallback to parent
    expect(page).toContain('variantGalleryImages(');
    expect(page).toContain('selectedPack');
    expect(page).toContain('productImages');
    // Variant gallery per pack (0028) is used when available
    expect(page).toContain('packImagesByPackId');
    expect(page).toContain('product_pack_images');
  });

  it('the gallery renders contain-fit and opens a native dialog lightbox', () => {
    const gallery = read('components/retailer/product-gallery.tsx');
    expect(gallery).toContain('object-contain');
    // Full-size mobile image area: large height, not tiny image in large empty card
    expect(gallery).toMatch(/min-h-\[360px\]|min-h-\[420px\]|min-h-\[520px\]/);
    expect(gallery).toContain('<dialog');
    expect(gallery).toContain('showModal()');
    expect(gallery).toContain('Open image viewer for');
    // Accessible alt text and counter for multiple images
    expect(gallery).toContain('aria-label');
    expect(gallery).toContain('Product image unavailable');
    // Swipe, keyboard, zoom controls
    expect(gallery).toContain('onTouchStart');
    expect(gallery).toContain('ArrowLeft');
    expect(gallery).toContain('ZoomIn');
    // Thumbnail strip is scrollable and accessible
    expect(gallery).toContain('overflow-x-auto');
  });
});

// ---------------------------------------------------------------------------
// 4. Variant-specific pricing — each size carries its OWN server price
// ---------------------------------------------------------------------------

describe('variant-specific price', () => {
  it('resolves each variant from its own tiers/price — no cross-variant mixing', () => {
    const pricing = new Map<string, VariantPricingInput>([
      [PACK_50G, { piecePrice: 25, mrp: 30, hasOffer: false }],
      [PACK_100G, { piecePrice: 48, mrp: 70, hasOffer: false }],
      [PACK_200G, { piecePrice: 90, mrp: null, hasOffer: false }],
    ]);
    const bases: VariantPackBase[] = [
      { id: PACK_50G, pack_name: '50g', is_active: true, sort_order: 0 },
      { id: PACK_100G, pack_name: '100g', is_active: true, sort_order: 1 },
      { id: PACK_200G, pack_name: '200g', is_active: true, sort_order: 2 },
    ];
    const model = buildVariantSwitcher(bases, null, pricing);
    expect(model.variants[0]?.pricing?.piecePrice).toBe(25);
    expect(model.variants[1]?.pricing?.piecePrice).toBe(48);
    expect(model.variants[2]?.pricing?.piecePrice).toBe(90);
    // Discount only when a real MRP is genuinely higher.
    expect(model.variants[0]?.pricing?.discountPercent).toBe(17); // 30 → 25
    expect(model.variants[2]?.pricing?.discountPercent).toBe(0); // no MRP
  });

  it('the page computes every variant price with the shared server-side resolver', () => {
    const page = read('app/retailer/catalog/[id]/page.tsx');
    expect(page).toContain('piecePrice: pieceRateForPack(');
    expect(page).toContain('const selectedPiecePrice =');
    expect(page).toContain('calcDiscountPercent(selectedPack?.mrp, selectedPiecePrice)');
    // The discount badge on the image only exists when MRP and price are real.
    expect(page).toContain('{discount > 0 ? (');
    expect(page).not.toContain('4.2'); // no invented rating-like number
  });

  it('formatVariantTierSummary renders real slab ranges only (display-only)', () => {
    const slab = (
      min_quantity: number,
      max_quantity: number | null,
      price_per_piece: number,
      is_active?: boolean
    ) =>
      ({
        min_quantity,
        max_quantity,
        price_per_piece,
        ...(is_active === false ? { is_active: false } : {}),
      }) as PricingTier;
    expect(formatVariantTierSummary([])).toBeNull();
    expect(formatVariantTierSummary(null)).toBeNull();
    expect(formatVariantTierSummary([slab(1, 7, 30)])).toBe('1–6');
    // inactive slabs never render
    expect(formatVariantTierSummary([slab(1, 7, 30), slab(7, null, 28, false)])).toBe('1–6');
    expect(formatVariantTierSummary([slab(1, 7, 30), slab(7, 13, 28), slab(13, null, 26)])).toBe(
      '1–6 · 7–12 · 13+'
    );
    // More than three slabs collapse to first … last.
    expect(
      formatVariantTierSummary([slab(1, 5, 30), slab(5, 10, 29), slab(10, 20, 28), slab(20, null, 26)])
    ).toBe('1–4 … 20+');
  });

  it('the size switcher shows the tier summary (or a single-rate note) — never a hardcoded one', () => {
    const switcher = read('components/retailer/variant-switcher.tsx');
    expect(switcher).toContain('Slabs ${pricing.tierSummary}');
    expect(switcher).toContain('Single rate per piece');
    // The page derives the summary from the variant's own resolved slabs.
    const page = read('app/retailer/catalog/[id]/page.tsx');
    expect(page).toContain('formatVariantTierSummary(');
    expect(page).toContain('resolveLooseTierSet(packTiers.get(pack.id) ?? [], pack.units_per_case)');
  });
});

// ---------------------------------------------------------------------------
// 5. Quantity tier price changes — the piece engine, no second implementation
// ---------------------------------------------------------------------------

describe('quantity tier price changes', () => {
  const tiers: PricingTier[] = [
    { id: 't1', min_quantity: 1, max_quantity: 7, price_per_piece: 30, rule_type: 'loose' },
    { id: 't2', min_quantity: 7, max_quantity: 13, price_per_piece: 28, rule_type: 'loose' },
    { id: 't3', min_quantity: 13, max_quantity: null, price_per_piece: 26, rule_type: 'loose' },
  ];

  function price(qty: number) {
    return calculateRetailerPiecePrice({
      quantity: qty,
      unitsPerCase: 24,
      casePrice: 0,
      tiers,
      gstPercent: 5,
      moq: 1,
    });
  }

  it('crosses slabs at the right boundaries and bills qty × applicable rate', () => {
    expect(price(6).unitPrice).toBe(30);
    expect(price(7).unitPrice).toBe(28);
    expect(price(13).unitPrice).toBe(26);
    const at7 = price(7);
    expect(at7.lineTotal).toBe(7 * 28);
    // GST is extracted from the inclusive total — never added on top.
    expect(round2(at7.subtotal + at7.gst)).toBe(at7.lineTotal);
    expect(at7.gst).toBe(round2(((7 * 28) * 5) / 105));
  });

  it('extends the deepest slab above the last configured boundary', () => {
    expect(pickRetailerPieceTier(tiers, 99)?.price_per_piece).toBe(26);
    expect(price(99).lineTotal).toBe(99 * 26);
  });

  it('rejects below-MOQ quantities with a message instead of a price', () => {
    const below = calculateRetailerPiecePrice({
      quantity: 2,
      unitsPerCase: 24,
      casePrice: 0,
      tiers,
      gstPercent: 5,
      moq: 5,
    });
    expect(below.orderable).toBe(false);
    expect(below.message).toMatch(/minimum order quantity/i);
  });

  it('the pack selector re-prives live through the same engine (no local formula)', () => {
    const selector = read('components/retailer/pack-selector.tsx');
    expect(selector).toContain('calculateRetailerPiecePrice({');
    expect(selector).toContain('<RetailerLineBreakdown className="mt-2.5" pricing={pricing} />');
    // No arithmetic of its own for the line total.
    expect(selector).not.toMatch(/lineTotal\s*=\s*qty\s*\*/);
    expect(selector).not.toContain('calculateCaseLoosePrice');
  });
});

// ---------------------------------------------------------------------------
// 6. Cart line identity — (retailer_id, pack_id) is the line key
// ---------------------------------------------------------------------------

interface FakeCartLine {
  id: string;
  retailer_id: string;
  pack_id: string;
  quantity: number;
}

function makeCartSupabase(initial: FakeCartLine[]) {
  const lines: FakeCartLine[] = [...initial];
  const calls: { op: 'insert' | 'update'; payload: Record<string, unknown> }[] = [];

  function makeChain() {
    const filters: Record<string, unknown> = {};
    const chain = {
      select: () => chain,
      eq: (col: string, val: unknown) => {
        filters[col] = val;
        return chain;
      },
      maybeSingle: async () => {
        const match =
          lines.find((line) =>
            Object.entries(filters).every(
              ([key, value]) => (line as unknown as Record<string, unknown>)[key] === value
            )
          ) ?? null;
        return { data: match, error: null };
      },
      update: (payload: Record<string, unknown>) => ({
        eq: (col: string, val: unknown) => {
          filters[col] = val;
          const match = lines.find((line) => line.id === (filters.id as string));
          if (match && typeof payload.quantity === 'number') match.quantity = payload.quantity;
          calls.push({ op: 'update', payload });
          return Promise.resolve({ error: null });
        },
      }),
      insert: (payload: Record<string, unknown>) => {
        lines.push({
          id: `new-${lines.length}`,
          retailer_id: String(payload.retailer_id),
          pack_id: String(payload.pack_id),
          quantity: Number(payload.quantity),
        });
        calls.push({ op: 'insert', payload });
        return Promise.resolve({ error: null });
      },
    };
    return chain;
  }

  return { from: () => makeChain(), lines, calls };
}

describe('cart line identity', () => {
  it('merges into the existing (retailer, pack) line and never into another pack', async () => {
    const fake = makeCartSupabase([{ id: 'ci-1', retailer_id: RETAILER_ID, pack_id: PACK_50G, quantity: 4 }]);
    await mergeLinesIntoCart(fake as never, RETAILER_ID, [{ packId: PACK_50G, quantity: 2 }]);
    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0]).toMatchObject({ op: 'update', payload: { quantity: 6 } });
    expect(fake.lines).toHaveLength(1);

    // A different variant of the same product is a DISTINCT line.
    await mergeLinesIntoCart(fake as never, RETAILER_ID, [{ packId: PACK_100G, quantity: 3 }]);
    expect(fake.lines).toHaveLength(2);
    expect(fake.lines.find((line) => line.pack_id === PACK_100G)?.quantity).toBe(3);
    expect(fake.lines.find((line) => line.pack_id === PACK_50G)?.quantity).toBe(6);
  });

  it('the store keeps a unique (retailer_id, pack_id) constraint', () => {
    expect(read('supabase/migrations/0007_pack_based_ordering.sql')).toContain('unique (retailer_id, pack_id)');
  });

  it('the page maps existing cart lines by pack id into the selector', () => {
    const page = read('app/retailer/catalog/[id]/page.tsx');
    expect(page).toContain('cartItemByPackId.set(item.pack_id, { id: item.id, quantity: item.quantity });');
  });
});

// ---------------------------------------------------------------------------
// 7 & 8. Add-to-cart and buy-now — client submits (packId, pieces) only
// ---------------------------------------------------------------------------

describe('add-to-cart behaviour', () => {
  const actions = read('lib/retailer/cart-actions.ts');
  const selector = read('components/retailer/pack-selector.tsx');

  it('accepts only (packId, quantity) — no price, gst, stock or discount from the client', () => {
    expect(actions).toContain('export async function addToCartAction(packId: string, quantity: number)');
    expect(actions).not.toMatch(/addToCartAction\([^)]*price/);
    // Server-side validation re-runs the pack's real rules before writing.
    const service = read('lib/retailer/cart-service.ts');
    expect(service).toContain('validatePackForCart(supabase, line.packId, line.quantity)');
    expect(service).toContain('if (!pack.is_active) return');
  });

  it('the product page sends exactly the selected variant/pack id with the piece count', () => {
    expect(selector).toContain('addToCartAction(pack.id, qty)');
    expect(selector).toContain('updateCartQuantityAction(inCart.cartItemId, qty)');
  });
});

describe('buy-now behaviour', () => {
  const actions = read('lib/retailer/cart-actions.ts');
  const selector = read('components/retailer/pack-selector.tsx');

  it('buy-now is add-to-cart + redirect to checkout, still server-validated', () => {
    expect(actions).toContain("export async function buyNowAction(packId: string, quantity: number)");
    expect(actions).toContain('redirect(\'/retailer/checkout\')');
    expect(actions).toContain('const result = await addToCartAction(packId, quantity);');
  });

  it('the selected variant card and the page footer both buy via the action (pack.id, qty) only', () => {
    expect(selector).toContain('await buyNowAction(pack.id, qty)');
    expect(selector).toContain('Buy now — 1-click checkout');
    expect(selector).toContain('onClick={() => handleBuyPack(pack)}');
  });
});

// ---------------------------------------------------------------------------
// 9 & 10. Sticky cart summary + real cart badge
// ---------------------------------------------------------------------------

describe('sticky cart summary', () => {
  const selector = read('components/retailer/pack-selector.tsx');

  it('shows the real server-computed cart count, total and MRP savings', () => {
    expect(selector).toContain('cartSummary?.itemCount');
    expect(selector).toContain('formatInr(cartSummary!.grandTotal)');
    expect(selector).toContain('Saving {formatInr(cartSummary!.savings)} vs MRP');
    expect(selector).toContain('View Cart');
  });

  it('offers the add action for the selected variant only when it has a real pending quantity', () => {
    expect(selector).toContain('const pendingAdd = (() => {');
    expect(selector).toContain('if (qty <= 0 || qty === inCartQty) return null;');
    expect(selector).toContain('if (!pricing.orderable) return null;');
  });

  it('updates an existing cart line exactly (never merges) when the pending qty differs', () => {
    expect(selector).toContain('isUpdate: inCartQty > 0');
    expect(selector).toContain('onClick={() => handleUpdateSinglePack(pendingAdd.pack)}');
    expect(selector).toContain('{pendingAdd.isUpdate ? \'Update\' : \'Add\'}');
  });

  it('sits above the bottom nav with the shared safe-area offset, and is the only fixed bar', () => {
    const fixedBars =
      selector.match(/fixed inset-x-0 bottom-\[calc\(4\.25rem\+env\(safe-area-inset-bottom\)\)\]/g) ?? [];
    expect(fixedBars).toHaveLength(1);
    const nav = read('components/layout/mobile-bottom-nav.tsx');
    expect(nav).toContain('h-[calc(4.25rem+env(safe-area-inset-bottom))]');
  });

  it('does not render a second competing sticky bar on the product page', () => {
    const page = read('app/retailer/catalog/[id]/page.tsx');
    // The page itself never adds a position:fixed bar — the selector owns it.
    expect(page).not.toContain('fixed inset-x-0');
  });
});

describe('real cart badge', () => {
  it('the layout counts the real cart lines and feeds the shell', () => {
    const layout = read('app/retailer/layout.tsx');
    expect(layout).toContain(".from('cart_items')");
    expect(layout).toContain("{ count: 'exact', head: true }");
    expect(layout).toContain('cartCount={cartCount ?? 0}');
  });

  it('the header cart icon and the bottom nav both render that count', () => {
    const shell = read('components/layout/retailer-shell.tsx');
    expect(shell).toContain('<CountBadge count={cartCount} />');
    expect(shell).toContain('icon: ShoppingCart, badge: cartCount');
  });
});

// ---------------------------------------------------------------------------
// 11. Unavailable variant state
// ---------------------------------------------------------------------------

describe('unavailable variant state', () => {
  it('an inactive variant is unavailable: no link, no price, disabled visual', () => {
    const bases: VariantPackBase[] = [
      { id: PACK_50G, pack_name: '50g', is_active: true, sort_order: 0 },
      { id: PACK_200G, pack_name: '200g', is_active: false, sort_order: 1 },
    ];
    const model = buildVariantSwitcher(bases, null, new Map([[PACK_50G, { piecePrice: 25, mrp: 30 }]]));
    expect(model.variants[1]?.isAvailable).toBe(false);
    expect(model.hasSelectableVariants).toBe(true);

    const switcher = read('components/retailer/variant-switcher.tsx');
    expect(switcher).toContain('if (!variant.isAvailable)');
    expect(switcher).toContain('aria-disabled="true"');
    // The unavailable card is a <span>, not a <Link>.
    expect(switcher).toContain('cursor-not-allowed');
  });

  it('inactive packs are excluded from the orderable selector entirely', () => {
    const page = read('app/retailer/catalog/[id]/page.tsx');
    expect(page).toContain('const activePacks = rawPacks.filter((pack) => pack.is_active);');
    expect(page).toContain('const packs = activePacks.map((pack) => {');
  });
});

// ---------------------------------------------------------------------------
// 12. Mobile responsive layout
// ---------------------------------------------------------------------------

describe('mobile responsive layout', () => {
  it('the header stays usable at 320px: truncating wordmark, fixed icon sizes, back button only on product pages', () => {
    const shell = read('components/layout/retailer-shell.tsx');
    expect(shell).toContain('isProductDetail');
    expect(shell).toContain('aria-label="Go back"');
    expect(shell).toContain('router.back()');
    expect(shell).toContain("router.replace('/retailer/catalog')");
    expect(shell).toContain('min-w-0 shrink');
    expect(shell).toContain('truncate text-[14px] font-bold');
    // Safe-area top inset for notched Android / Capacitor.
    expect(shell).toContain('pt-[env(safe-area-inset-top)]');
    // Root layout opts into safe-area insets.
    expect(read('app/layout.tsx')).toContain("viewportFit: 'cover'");
  });

  it('bottom navigation is the real five-tab marketplace nav with the cart badge', () => {
    const shell = read('components/layout/retailer-shell.tsx');
    for (const label of ['Home', 'Categories', 'Brands', 'Cart', 'Account']) {
      expect(shell).toContain(`{ label: '${label}'`);
    }
    expect(shell).toContain('href: \'/retailer/cart\'');
  });

  it('the product page leaves room for nav + sticky bar on phones', () => {
    const page = read('app/retailer/catalog/[id]/page.tsx');
    expect(page).toContain("hasCartItems && 'pb-36 sm:pb-36'");
  });
});

// ---------------------------------------------------------------------------
// 13. No internal / purchased-cost data on the retailer surface
// ---------------------------------------------------------------------------

describe('retailer cannot see purchase cost or internal fields', () => {
  const surfaces = [
    'app/retailer/catalog/[id]/page.tsx',
    'components/retailer/pack-selector.tsx',
    'components/retailer/variant-switcher.tsx',
    'components/retailer/product-gallery.tsx',
    'components/retailer/share-button.tsx',
    'components/layout/retailer-shell.tsx',
  ];

  it('no purchase-cost, supplier or internal-sku identifiers on the new/changed surfaces', () => {
    for (const file of surfaces) {
      const source = read(file).toLowerCase();
      for (const forbidden of [
        'purchase cost',
        'purchase_cost',
        'purchase price',
        'purchase_price',
        'cost_price',
        'supplier cost',
        'supplier',
        'pack_sku_code',
        'internal sku',
        'internal_sku',
      ]) {
        expect(source, `${file} :: ${forbidden}`).not.toContain(forbidden);
      }
    }
  });

  it('components never receive or render the internal case price field', () => {
    for (const file of [
      'components/retailer/pack-selector.tsx',
      'components/retailer/variant-switcher.tsx',
      'components/retailer/product-gallery.tsx',
    ]) {
      // Comments may document the internal model; the code must not touch it.
      const codeOnly = read(file)
        .split('\n')
        .filter(
          (line) =>
            !line.trimStart().startsWith('*') &&
            !line.trimStart().startsWith('//') &&
            !line.trimStart().startsWith('/*')
        )
        .join('\n');
      expect(codeOnly, file).not.toContain('case_price');
    }
    // The page may READ case_price server-side, but must never interpolate it
    // into JSX output.
    expect(read('app/retailer/catalog/[id]/page.tsx')).not.toMatch(/\{\s*pack\.case_price\s*\}/);
    expect(read('app/retailer/catalog/[id]/page.tsx')).not.toMatch(/\{\s*internalCasePrice\s*\}/);
  });

  it('no fake ratings, reviews or invented stock anywhere on the page', () => {
    const page = read('app/retailer/catalog/[id]/page.tsx');
    // Comments describing the internal model are fine — what the retailer
    // would actually READ must stay clean. Strip comment lines like the
    // existing page-scans do.
    const rendered = page
      .split('\n')
      .filter(
        (line) =>
          !line.trimStart().startsWith('*') &&
          !line.trimStart().startsWith('//') &&
          !line.trimStart().startsWith('/*')
      )
      .join('\n');
    expect(rendered).not.toMatch(/\b(rating|ratings?)\b/i);
    expect(rendered).not.toMatch(/\bstars?\b/i);
    expect(rendered).not.toMatch(/\b\d+\.\d\s*\/\s*5\b/i); // no "4.2 / 5" style ratings
    expect(rendered).not.toMatch(/review count|customer reviews|average review/i);
    expect(rendered).not.toMatch(/\bstock\b/i);
    expect(rendered).not.toMatch(/\binventory\b/i);
  });

  it('the share payload is only the real product URL (no price/stock data)', () => {
    const share = read('components/retailer/share-button.tsx');
    expect(share).toContain('const url = window.location.href;');
    expect(share).toContain('await navigator.share({ title, url });');
    expect(share).toContain('await navigator.clipboard.writeText(url);');
    // The only value shared is the location URL — the share call takes
    // exactly { title, url } and nothing else.
    expect(share).not.toMatch(/navigator\.share\(\{[^}]*\b(price|mrp|gst|stock|cost)\b/i);
    expect(share).not.toMatch(/clipboard\.writeText\((?!url\))/);
  });

  it('discount numbers always come from the shared MRP-vs-price helper', () => {
    expect(calcDiscountPercent(158, 131)).toBe(17);
    expect(calcDiscountPercent(null, 131)).toBe(0);
    expect(calcDiscountPercent(100, 131)).toBe(0); // MRP below price → no fake saving
    expect(calcSavings(158, 131, 3)).toBe(81);
  });
});

// ---------------------------------------------------------------------------
// Pricing integrity — the same engine runs client preview and server quote
// ---------------------------------------------------------------------------

describe('pricing integrity across surfaces', () => {
  it('the server quote prices with the same piece engine the UI previews with', () => {
    expect(read('lib/orders/quote-order.ts')).toContain('calculateRetailerPiecePrice({');
    expect(read('app/retailer/catalog/[id]/page.tsx')).toContain('calculateRetailerPiecePrice({');
    expect(read('components/retailer/pack-selector.tsx')).toContain('calculateRetailerPiecePrice({');
  });

  it('GST-inclusive math reconciles to the paisa at a tier boundary', () => {
    const tiers: PricingTier[] = [
      { id: 't1', min_quantity: 1, max_quantity: 7, price_per_piece: 131, rule_type: 'loose' },
      { id: 't2', min_quantity: 7, max_quantity: null, price_per_piece: 128, rule_type: 'loose' },
    ];
    const pricing = calculateRetailerPiecePrice({
      quantity: 7,
      unitsPerCase: 12,
      casePrice: 0,
      tiers,
      gstPercent: 18,
      moq: 1,
    });
    expect(pricing.unitPrice).toBe(128);
    expect(pricing.lineTotal).toBe(7 * 128);
    expect(round2(pricing.subtotal + pricing.gst)).toBe(pricing.lineTotal);
    // The resolved loose set is what both the UI and the engine use.
    expect(resolveLooseTierSet(tiers, 12).tiers).toHaveLength(2);
  });
});
