import 'server-only';

import type { createClient } from '@/lib/supabase/server';
import type { PricingTier } from '@/lib/retailer/case-pricing';

interface TierRow {
  id: string;
  product_pack_id: string;
  min_quantity: number;
  max_quantity: number | null;
  price_per_piece: number;
  rule_type: 'default' | 'case' | 'bulk';
  label: string | null;
  is_active: boolean;
}

const TIER_CHUNK = 80;

/** Loads the active pricing tiers for a set of packs, keyed by pack id. */
export async function loadPackTiers(
  supabase: ReturnType<typeof createClient>,
  packIds: string[]
): Promise<Map<string, PricingTier[]>> {
  const unique = [...new Set(packIds.filter(Boolean))];
  const result = new Map<string, PricingTier[]>();
  if (unique.length === 0) return result;

  for (let index = 0; index < unique.length; index += TIER_CHUNK) {
    const chunk = unique.slice(index, index + TIER_CHUNK);
    const { data } = await supabase
      .from('product_pricing_tiers')
      .select('id, product_pack_id, min_quantity, max_quantity, price_per_piece, rule_type, label, is_active')
      .in('product_pack_id', chunk)
      .eq('is_active', true)
      .order('min_quantity', { ascending: true })
      .returns<TierRow[]>();
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
  return result;
}
