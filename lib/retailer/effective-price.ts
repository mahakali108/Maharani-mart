import 'server-only';
import type { createClient } from '@/lib/supabase/server';

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
interface ScopedPriceRow {
  product_id: string;
  price: number;
  priority: number;
}

const PRICE_IN_CHUNK = 80;

function pickHighestPriority(rows: ScopedPriceRow[]): Map<string, number> {
  const best = new Map<string, { price: number; priority: number }>();
  for (const row of rows) {
    const current = best.get(row.product_id);
    if (!current || row.priority > current.priority) {
      best.set(row.product_id, { price: row.price, priority: row.priority });
    }
  }
  return new Map([...best.entries()].map(([productId, value]) => [productId, value.price]));
}

async function loadScopedOverrides(
  supabase: ReturnType<typeof createClient>,
  productIds: string[],
  nowIso: string,
  scope: 'retailer' | 'area',
  match: { retailerId?: string; areaId?: string }
): Promise<ScopedPriceRow[]> {
  const rows: ScopedPriceRow[] = [];
  for (let index = 0; index < productIds.length; index += PRICE_IN_CHUNK) {
    const chunk = productIds.slice(index, index + PRICE_IN_CHUNK);
    let query = supabase
      .from('price_lists')
      .select('product_id, price, priority')
      .in('product_id', chunk)
      .eq('scope', scope)
      .eq('is_active', true)
      .lte('valid_from', nowIso);
    if (scope === 'retailer' && match.retailerId) query = query.eq('retailer_id', match.retailerId);
    if (scope === 'area' && match.areaId) query = query.eq('area_id', match.areaId);
    const { data } = await query.returns<ScopedPriceRow[]>();
    if (data) rows.push(...data);
  }
  return rows;
}

/**
 * Batch equivalent of getProductPriceOverride. Uses the same scope
 * priority (retailer, then area) and the same valid_from / is_active
 * filters — it does not invent extra override sources.
 */
export async function getProductPriceOverrides(
  supabase: ReturnType<typeof createClient>,
  productIds: string[],
  retailerId: string,
  areaId: string | null
): Promise<Map<string, number | null>> {
  const unique = [...new Set(productIds.filter(Boolean))];
  const result = new Map<string, number | null>(unique.map((id) => [id, null]));
  if (unique.length === 0) return result;

  const nowIso = new Date().toISOString();
  const retailerBest = pickHighestPriority(
    await loadScopedOverrides(supabase, unique, nowIso, 'retailer', { retailerId })
  );
  for (const [productId, price] of retailerBest) result.set(productId, price);

  const missing = unique.filter((id) => result.get(id) === null);
  if (areaId && missing.length > 0) {
    const areaBest = pickHighestPriority(
      await loadScopedOverrides(supabase, missing, nowIso, 'area', { areaId })
    );
    for (const [productId, price] of areaBest) result.set(productId, price);
  }

  return result;
}

export async function getProductPriceOverride(
  supabase: ReturnType<typeof createClient>,
  productId: string,
  retailerId: string,
  areaId: string | null
): Promise<number | null> {
  const overrides = await getProductPriceOverrides(supabase, [productId], retailerId, areaId);
  return overrides.get(productId) ?? null;
}

/** Product IDs that currently have an active scheme/festival price row (badge only). */
export async function getActiveOfferProductIds(
  supabase: ReturnType<typeof createClient>,
  productIds: string[]
): Promise<Set<string>> {
  const unique = [...new Set(productIds.filter(Boolean))];
  const offered = new Set<string>();
  if (unique.length === 0) return offered;

  const nowIso = new Date().toISOString();
  for (let index = 0; index < unique.length; index += PRICE_IN_CHUNK) {
    const chunk = unique.slice(index, index + PRICE_IN_CHUNK);
    const { data } = await supabase
      .from('price_lists')
      .select('product_id')
      .in('product_id', chunk)
      .in('scope', ['scheme', 'festival'])
      .eq('is_active', true)
      .lte('valid_from', nowIso)
      .returns<{ product_id: string }[]>();
    for (const row of data ?? []) offered.add(row.product_id);
  }
  return offered;
}

/**
 * Given a pack's own pricing fields and any product-level override, returns
 * the fixed GST-INCLUSIVE CASE selling price a retailer pays for one case of
 * that pack (the source of truth in the case-based pricing model).
 *
 * An existing `price_lists` override (retailer > area > base) is interpreted
 * as a case-price override for the whole product. When no override exists the
 * pack's own `case_price` is used. The legacy `ptr`/`base_price` fields are
 * kept only as a migration fallback for packs that predate case_price.
 *
 * The per-piece price is derived from this case price (case_price /
 * units_per_case) — it is never read from a stored field here.
 */
export function resolvePackCasePrice(
  pack: { case_price?: number | null; ptr: number | null; base_price: number },
  productOverride: number | null
): number {
  if (productOverride !== null) return productOverride;
  return pack.case_price ?? pack.ptr ?? pack.base_price;
}

/** @deprecated Prefer resolvePackCasePrice — kept for display call-sites. */
export function resolvePackPrice(
  pack: { case_price?: number | null; ptr: number | null; base_price: number },
  productOverride: number | null
): number {
  return resolvePackCasePrice(pack, productOverride);
}
