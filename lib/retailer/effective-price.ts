import 'server-only';
import type { createClient } from '@/lib/supabase/server';

interface PriceOverrideRow {
  price: number;
}

/**
 * Resolves a product-level price override for a retailer, if one
 * exists — retailer-specific override wins over area-specific, which
 * wins over "no override" (in which case the caller falls back to the
 * pack's own PTR/base_price).
 *
 * This is the ONLY place this logic lives. Catalog, product detail,
 * cart, and checkout all call this same function so a retailer is
 * guaranteed to see (and be charged) the exact same price everywhere
 * — there is no second implementation to drift out of sync.
 *
 * Scope note: an override here applies to the whole product (every
 * pack of it), not to one specific pack. Per-pack overrides are a
 * reasonable Phase 3 extension if the business needs finer control;
 * for now this matches how `price_lists` was originally modeled
 * (against product_id, before Packs existed).
 *
 * The `supabase` parameter is typed from the actual client factory's
 * return type (`ReturnType<typeof createClient>`) rather than a
 * hand-written `SupabaseClient<Database>` annotation — the exact
 * generic signature of `SupabaseClient` varies across
 * @supabase/supabase-js versions (2-arg vs 3-arg forms), and
 * re-declaring it here is what caused a real build failure. Deriving
 * the type from the factory itself means this function is always
 * structurally compatible with whatever `createClient()` produces,
 * regardless of the installed package version.
 */
export async function getProductPriceOverride(
  supabase: ReturnType<typeof createClient>,
  productId: string,
  retailerId: string,
  areaId: string | null
): Promise<number | null> {
  const nowIso = new Date().toISOString();

  const { data: retailerOverride } = await supabase
    .from('price_lists')
    .select('price')
    .eq('product_id', productId)
    .eq('scope', 'retailer')
    .eq('retailer_id', retailerId)
    .eq('is_active', true)
    .lte('valid_from', nowIso)
    .order('priority', { ascending: false })
    .limit(1)
    .maybeSingle<PriceOverrideRow>();

  if (retailerOverride) return retailerOverride.price;

  if (areaId) {
    const { data: areaOverride } = await supabase
      .from('price_lists')
      .select('price')
      .eq('product_id', productId)
      .eq('scope', 'area')
      .eq('area_id', areaId)
      .eq('is_active', true)
      .lte('valid_from', nowIso)
      .order('priority', { ascending: false })
      .limit(1)
      .maybeSingle<PriceOverrideRow>();

    if (areaOverride) return areaOverride.price;
  }

  return null;
}

/**
 * Given a pack's own pricing fields and any product-level override,
 * returns the final per-unit price a retailer pays for that pack.
 */
export function resolvePackPrice(
  pack: { ptr: number | null; base_price: number },
  productOverride: number | null
): number {
  if (productOverride !== null) return productOverride;
  return pack.ptr ?? pack.base_price;
}
