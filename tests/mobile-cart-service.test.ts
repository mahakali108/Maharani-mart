/**
 * `loadMobileCart` — the server side of the native cart (`GET /api/mobile/v1/cart`).
 *
 * These run against the REAL service with Supabase mocked at the client
 * boundary, so they cover what the route-level tests cannot (those mock the
 * service out): the mapping from the `get_retailer_cart_lines` RPC rows to the
 * line the shopper sees.
 *
 * What is locked here:
 *   1. identity — product name, brand, pack size and the pack/picture a cart
 *      row can be recognised by (image precedence: pack artwork, then the
 *      product's primary image, then null for the monogram tile);
 *   2. money — integer paise from the shared pricing engine, never a float and
 *      never anything the client sent;
 *   3. MOQ/units-per-case travel as the server reported them;
 *   4. `orderable` is true only for an active, priced line the server reports
 *      as in stock — the state the checkout CTA is gated on;
 *   5. the badge counts are the server's own count of saved rows and pieces.
 */
import { describe, expect, it } from 'vitest';
import { loadMobileCart } from '@/lib/mobile/commerce-service';
import type { MobileSession } from '@/lib/mobile/auth';
import { supabaseFixture } from './helpers/supabase-fixture';

const RETAILER = '11111111-1111-4111-8111-111111111111';
const PRODUCT = '22222222-2222-4222-8222-222222222222';
const PACK = '33333333-3333-4333-8333-333333333333';
const LINE = '44444444-4444-4444-8444-444444444444';
const BRAND = '55555555-5555-4555-8555-555555555555';

const PACK_IMAGE = 'https://cdn.maharanitraders.test/storage/v1/object/public/product-images/pack.jpg';
const PRODUCT_IMAGE = 'https://cdn.maharanitraders.test/storage/v1/object/public/product-images/product.jpg';

function tables(overrides: { packImage?: string | null; productImage?: boolean } = {}) {
  return {
    products: [
      {
        id: PRODUCT,
        name: 'Basmati Rice 5kg',
        category_id: 'cat-1',
        brand_id: BRAND,
        gst_percent: 5,
        is_new_launch: false,
        // The row the real `products` read filters on (`is_active` is a column,
        // not part of the card projection), so the double needs it too.
        is_active: true,
        created_at: '2026-01-01T00:00:00.000Z',
        brands: { id: BRAND, name: 'Maharani' },
        product_images: overrides.productImage === false
          ? []
          : [{ image_url: PRODUCT_IMAGE, sort_order: 1 }],
        product_packs: [
          {
            id: PACK,
            pack_name: '5 kg',
            ptr: null,
            base_price: 1200,
            case_price: 1200,
            units_per_case: 12,
            mrp: 1500,
            moq: 6,
            image_url: overrides.packImage === undefined ? PACK_IMAGE : overrides.packImage,
            is_active: true,
            sort_order: 0,
          },
        ],
      },
    ],
    retailers: [{ id: RETAILER, area_id: 'area-1', status: 'active' }],
    product_pricing_tiers: [
      {
        id: 'tier-1',
        product_pack_id: PACK,
        min_quantity: 1,
        max_quantity: null,
        price_per_piece: 100,
        rule_type: 'default',
        is_active: true,
      },
    ],
    cart_items: [{ id: LINE, retailer_id: RETAILER, product_id: PRODUCT, pack_id: PACK, quantity: 6 }],
  };
}

/** One row serves both RPCs the service calls: it carries the cart fields AND a stock status. */
function cartRpcRow(overrides: Record<string, unknown> = {}) {
  return {
    cart_item_id: LINE,
    pack_id: PACK,
    quantity: 6,
    product_id: PRODUCT,
    product_name: 'Basmati Rice 5kg',
    pack_name: '5 kg',
    units_per_case: 12,
    moq: 6,
    pack_active: true,
    product_active: true,
    stock_status: 'in_stock',
    ...overrides,
  };
}

function session(client: unknown): MobileSession {
  return { userId: RETAILER, supabase: client } as unknown as MobileSession;
}

describe('loadMobileCart', () => {
  it('maps the saved line with its brand, pack image and server price', async () => {
    const client = supabaseFixture(tables(), {}, [cartRpcRow()]);
    const cart = await loadMobileCart(session(client));

    expect(cart.lines).toHaveLength(1);
    const line = cart.lines[0]!;
    expect(line).toMatchObject({
      id: LINE,
      packId: PACK,
      productId: PRODUCT,
      productName: 'Basmati Rice 5kg',
      brandName: 'Maharani',
      imageUrl: PACK_IMAGE,
      packName: '5 kg',
      quantity: 6,
      quantityUnit: 'pieces',
      quantityIncrement: 1,
      moq: 6,
      unitsPerCase: 12,
      unitPricePaise: 10000,
      lineTotalPaise: 60000,
      gstPercent: 5,
      availability: 'in_stock',
      orderable: true,
      message: null,
    });
    // Prices are integers in paise — a float here would drift the cart total.
    expect(Number.isInteger(line.unitPricePaise)).toBe(true);
    expect(Number.isInteger(line.lineTotalPaise)).toBe(true);
  });

  it('falls back to the product image when the pack has none', async () => {
    const client = supabaseFixture(tables({ packImage: null }), {}, [cartRpcRow()]);
    const cart = await loadMobileCart(session(client));
    expect(cart.lines[0]?.imageUrl).toBe(PRODUCT_IMAGE);
  });

  it('reports no artwork rather than borrowing one', async () => {
    const client = supabaseFixture(tables({ packImage: null, productImage: false }), {}, [cartRpcRow()]);
    const cart = await loadMobileCart(session(client));
    expect(cart.lines[0]?.imageUrl).toBeNull();
    expect(cart.lines[0]?.brandName).toBe('Maharani');
  });

  it('refuses to price or order a line below its MOQ', async () => {
    // The cart row is 4 pieces but the pack's MOQ is 6: the server must not
    // accept the invalid quantity silently — it reports it as un-orderable
    // with a reason the cart screen renders.
    const client = supabaseFixture(tables(), {}, [cartRpcRow({ quantity: 4 })]);
    const cart = await loadMobileCart(session(client));
    const line = cart.lines[0]!;
    expect(line.orderable).toBe(false);
    expect(line.unitPricePaise).toBeNull();
    expect(line.message ?? '').toMatch(/minimum|MOQ|6/i);
  });

  it('marks an out-of-stock line as not orderable and explains why', async () => {
    const client = supabaseFixture(tables(), {}, [cartRpcRow({ stock_status: 'out_of_stock' })]);
    const cart = await loadMobileCart(session(client));
    const line = cart.lines[0]!;
    expect(line.availability).toBe('out_of_stock');
    expect(line.orderable).toBe(false);
    // The blocker text is what the cart screen shows next to the disabled CTA.
    expect(line.message ?? '').not.toBe('');
  });

  it('never marks an unknown-availability line as orderable', async () => {
    const client = supabaseFixture(tables(), {}, [cartRpcRow({ stock_status: 'unknown' })]);
    const cart = await loadMobileCart(session(client));
    expect(cart.lines[0]?.availability).toBe('unknown');
    expect(cart.lines[0]?.orderable).toBe(false);
  });

  it('retires a line whose pack was deactivated instead of pricing it', async () => {
    const client = supabaseFixture(tables(), {}, [cartRpcRow({ pack_active: false })]);
    const cart = await loadMobileCart(session(client));
    const line = cart.lines[0]!;
    expect(line.orderable).toBe(false);
    expect(line.unitPricePaise).toBeNull();
    expect(line.lineTotalPaise).toBeNull();
    // The saved row is still listed: the shopper must be able to remove it.
    expect(line.id).toBe(LINE);
    expect(line.quantity).toBe(6);
  });

  it('counts lines and pieces from the saved rows for the shell badge', async () => {
    const client = supabaseFixture(tables({ packImage: null, productImage: false }), {}, [
      cartRpcRow(),
      cartRpcRow({ cart_item_id: 'line-2', quantity: 6 }),
    ]);
    const cart = await loadMobileCart(session(client));
    expect(cart.lineCount).toBe(2);
    expect(cart.itemCount).toBe(12);
  });

  it('returns an empty cart — not an error — when nothing is saved', async () => {
    const client = supabaseFixture(tables(), {}, []);
    const cart = await loadMobileCart(session(client));
    expect(cart).toEqual({
      lines: [],
      couponCode: null,
      couponUnavailable: false,
      lineCount: 0,
      itemCount: 0,
    });
  });
});
