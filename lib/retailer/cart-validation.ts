import 'server-only';

import { createClient } from '@/lib/supabase/server';
import { calculateRetailerPiecePrice } from '@/lib/retailer/retailer-pricing';
import { getProductPriceOverride, resolvePackCasePrice } from '@/lib/retailer/effective-price';
import { loadPackTiers } from '@/lib/retailer/pricing-data';

interface PackForCart {
  id: string;
  product_id: string;
  pack_name: string;
  moq: number;
  units_per_case: number;
  case_price: number;
  ptr: number | null;
  base_price: number;
  is_active: boolean;
  products: { is_active: boolean } | null;
}

/** Validate one full intended persisted piece quantity against current server rules. */
async function quantityError(
  supabase: ReturnType<typeof createClient>,
  pack: PackForCart,
  quantity: number,
  productOverride: number | null,
) {
  const tiers = await loadPackTiers(supabase, [pack.id]);
  const pricing = calculateRetailerPiecePrice({
    quantity,
    unitsPerCase: pack.units_per_case,
    casePrice: resolvePackCasePrice(pack, productOverride),
    tiers: tiers.get(pack.id) ?? [],
    moq: pack.moq,
  });
  if (pricing.orderable && Number.isFinite(pricing.unitPrice) && Number.isFinite(pricing.lineTotal)) return null;
  return pricing.message ?? 'That quantity is not available for this pack.';
}

export async function validatePackForCart(
  supabase: ReturnType<typeof createClient>,
  retailerId: string,
  packId: string,
  quantity: number
): Promise<string | null> {
  // The shared retailer cart is a whole-piece model: every integer piece count
  // at or above MOQ is valid (step 1). Do not infer a case-size increment from
  // allow_loose_pieces; the canonical retailer quote uses the same piece rule.
  if (!packId || quantity < 1 || quantity > 100000 || !Number.isInteger(quantity)) {
    return 'Enter a valid whole number quantity in pieces.';
  }
  const { data: pack, error } = await supabase
    .from('product_packs')
    .select(
      'id, product_id, pack_name, moq, units_per_case, case_price, ptr, base_price, is_active, products ( is_active )'
    )
    .eq('id', packId)
    .maybeSingle<PackForCart>();
  if (error || !pack) return 'This pack no longer exists.';
  if (!pack.is_active) return 'This pack is currently unavailable.';
  if (!pack.products?.is_active) return 'This product is currently unavailable.';
  if (quantity < pack.moq) return `Minimum order quantity for this pack is ${pack.moq} pcs.`;
  try {
    const { data: retailer, error: retailerError } = await supabase
      .from('retailers')
      .select('area_id')
      .eq('id', retailerId)
      .maybeSingle<{ area_id: string | null }>();
    if (retailerError || !retailer) return 'Current retailer pricing could not be verified. Please try again.';
    const productOverride = await getProductPriceOverride(supabase, pack.product_id, retailerId, retailer.area_id);
    return await quantityError(supabase, pack, quantity, productOverride);
  } catch {
    return 'Current pricing could not be verified. Please try again.';
  }
}
