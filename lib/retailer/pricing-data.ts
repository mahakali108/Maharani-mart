import 'server-only';

import type { createClient } from '@/lib/supabase/server';
import type { PricingTier } from '@/lib/retailer/case-pricing';
import { loadEffectiveCategoryPrices } from '@/lib/retailer/category-pricing';

interface TierRow {
  id: string;
  product_pack_id: string;
  min_quantity: number;
  max_quantity: number | null;
  price_per_piece: number;
  rule_type: 'default' | 'case' | 'bulk' | 'loose';
  label: string | null;
  is_active: boolean;
}

const TIER_CHUNK = 80;

/**
 * Loads the active pricing tiers for a set of packs, keyed by pack id.
 *
 * When `retailerId` is supplied, a pack that has an administrator-configured
 * retailer-category price (migration 0082) is represented by ONE synthetic
 * tier at that price. That mirrors the database rule exactly — the category
 * price is authoritative for the line and quantity slabs do not override it —
 * and means every existing consumer (catalogue, cart, checkout preview,
 * reorder, quick order, coupon eligibility) prices the same way without a
 * second pricing implementation.
 *
 * Packs without a category price keep their real tier list, so the
 * pre-existing slab/case rules are untouched.
 */
export async function loadPackTiers(
  supabase: ReturnType<typeof createClient>,
  packIds: string[],
  retailerId?: string | null
): Promise<Map<string, PricingTier[]>> {
  const unique = [...new Set(packIds.filter(Boolean))];
  const result = new Map<string, PricingTier[]>();
  if (unique.length === 0) return result;

  for (let index = 0; index < unique.length; index += TIER_CHUNK) {
    const chunk = unique.slice(index, index + TIER_CHUNK);
    const { data, error } = await supabase
      .from('product_pricing_tiers')
      .select('id, product_pack_id, min_quantity, max_quantity, price_per_piece, rule_type, label, is_active')
      .in('product_pack_id', chunk)
      .eq('is_active', true)
      .order('min_quantity', { ascending: true })
      .returns<TierRow[]>();
    if (error) throw new Error('Selling tiers could not be loaded. Please try again.');
    for (const row of data ?? []) {
      const tiers = result.get(row.product_pack_id) ?? [];
      tiers.push({
        id: row.id,
        min_quantity: row.min_quantity,
        max_quantity: row.max_quantity,
        price_per_piece: row.price_per_piece,
        rule_type: row.rule_type,
        label: row.label,
        is_active: row.is_active,
      });
      result.set(row.product_pack_id, tiers);
    }
  }

  if (retailerId) {
    const { prices } = await loadEffectiveCategoryPrices(supabase, unique, retailerId);
    for (const [packId, price] of prices) {
      result.set(packId, [
        {
          id: `category-price:${packId}`,
          min_quantity: 1,
          max_quantity: null,
          price_per_piece: price,
          rule_type: 'loose',
          label: 'Your retailer price',
          is_active: true,
        },
      ]);
    }
  }

  return result;
}
