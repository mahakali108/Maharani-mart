import 'server-only';

import type { createClient } from '@/lib/supabase/server';
import { getProductPriceOverrides, resolvePackPrice } from '@/lib/retailer/effective-price';
import { calculateRetailerPiecePrice } from '@/lib/retailer/retailer-pricing';
import { loadPackTiers } from '@/lib/retailer/pricing-data';
import type { PricingTier } from '@/lib/retailer/case-pricing';
import { roundMoney } from '@/lib/orders/credit';
import type { CouponCartLine } from './types';

export interface CartCouponLinesResult {
  /** Billable lines: orderable AND available. Blocked lines are excluded —
   *  they cannot be billed, so they cannot satisfy a coupon either. */
  lines: CouponCartLine[];
  /** GST-exclusive subtotal of the billable lines. */
  subtotal: number;
  /** True when any read or pricing step failed; callers must not present a
   *  coupon discount as verified in that case. */
  error: boolean;
}

interface CartRow {
  product_id: string;
  pack_id: string;
  quantity: number;
  product_packs: {
    id: string;
    base_price: number;
    ptr: number | null;
    case_price: number;
    units_per_case: number;
    moq: number;
    is_active: boolean;
  } | null;
  products: {
    id: string;
    name: string;
    category_id: string | null;
    brand_id: string | null;
    gst_percent: number;
    is_active: boolean;
  } | null;
}

/**
 * Reads the caller's cart and prices every line through the SAME canonical
 * retailer piece engine the quote uses, then projects it into the coupon
 * engine's view (billable lines with scoping ids + GST-exclusive subtotals).
 * The retailer id is always the caller's session id — passed by the server.
 */
export async function loadCartCouponLines(
  supabase: ReturnType<typeof createClient>,
  retailerId: string,
  areaId: string | null
): Promise<CartCouponLinesResult> {
  const { data, error } = await supabase
    .from('cart_items')
    .select(
      'product_id, pack_id, quantity, product_packs ( id, base_price, ptr, case_price, units_per_case, moq, is_active ), products ( id, name, category_id, brand_id, gst_percent, is_active )'
    )
    .eq('retailer_id', retailerId);
  if (error) return { lines: [], subtotal: 0, error: true };

  const rows = (data ?? []) as unknown as CartRow[];
  if (rows.length === 0) return { lines: [], subtotal: 0, error: false };

  const productIds = [...new Set(rows.map((row) => row.product_id))];
  const packIds = rows.map((row) => row.pack_id);

  let overrides: Map<string, number | null>;
  let tierMap: Map<string, PricingTier[]>;
  try {
    [overrides, tierMap] = await Promise.all([
      getProductPriceOverrides(supabase, productIds, retailerId, areaId),
      loadPackTiers(supabase, packIds),
    ]);
  } catch {
    return { lines: [], subtotal: 0, error: true };
  }

  const lines: CouponCartLine[] = [];
  for (const row of rows) {
    const pack = row.product_packs;
    const product = row.products;
    if (!pack?.is_active || !product?.is_active) continue;

    const casePrice = resolvePackPrice(pack, overrides.get(product.id) ?? null);
    const pricing = calculateRetailerPiecePrice({
      quantity: row.quantity,
      unitsPerCase: pack.units_per_case,
      casePrice,
      tiers: tierMap.get(pack.id) ?? [],
      gstPercent: product.gst_percent,
      moq: pack.moq,
    });

    // Only lines the order engine would actually bill count toward a coupon.
    if (!pricing.orderable || !Number.isFinite(pricing.subtotal)) continue;

    lines.push({
      productId: product.id,
      categoryId: product.category_id,
      brandId: product.brand_id,
      subtotal: roundMoney(pricing.subtotal),
    });
  }

  return { lines, subtotal: roundMoney(lines.reduce((sum, line) => sum + line.subtotal, 0)), error: false };
}
