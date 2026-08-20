'use server';

import { createClient } from '@/lib/supabase/server';
import { requirePermission } from '@/lib/admin/guard';
import { sanitizeSearchTerm } from '@/lib/retailer/catalog-params';
import { cachedSearchSuggestions } from '@/lib/turso/catalog';
import {
  loadFavoriteIds,
  loadProductsByIds,
  priceCatalogProducts,
  type PricedCatalogCard,
} from '@/lib/retailer/catalog';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface SearchSuggestionResult {
  products: { id: string; name: string; skuCode: string; brandName?: string }[];
  brands: { id: string; name: string }[];
  categories: { id: string; name: string }[];
}

export async function searchSuggestionsAction(rawQuery: string): Promise<SearchSuggestionResult> {
  // Authorisation happens FIRST and always against Supabase. The optional
  // Turso cache below is only reached by an already-authorised caller, and
  // the cached payload is catalog-wide (no prices, no favourites, no
  // per-retailer data), so a cache hit can never leak anything.
  await requirePermission('products.view');
  const q = sanitizeSearchTerm(rawQuery);
  if (q.length < 2) return { products: [], brands: [], categories: [] };

  // If Turso is unset or unreachable this transparently runs the Supabase
  // query exactly as before — suggestions are a convenience, never a source
  // of truth.
  return cachedSearchSuggestions(q, () => loadSearchSuggestions(q));
}

/** The authoritative Supabase read behind the suggestions dropdown. */
async function loadSearchSuggestions(q: string): Promise<SearchSuggestionResult> {
  const supabase = createClient();
  const like = `"%${q}%"`;

  const [{ data: products }, { data: brands }, { data: categories }] = await Promise.all([
    supabase
      .from('products')
      .select('id, name, sku_code, brands ( name )')
      .eq('is_active', true)
      .or(`name.ilike.${like},sku_code.ilike.${like}`)
      .order('name')
      .limit(6)
      .returns<{ id: string; name: string; sku_code: string; brands: { name: string } | null }[]>(),
    supabase
      .from('brands')
      .select('id, name')
      .eq('is_active', true)
      .ilike('name', `%${q}%`)
      .order('name')
      .limit(4)
      .returns<{ id: string; name: string }[]>(),
    supabase
      .from('categories')
      .select('id, name')
      .eq('is_active', true)
      .ilike('name', `%${q}%`)
      .order('name')
      .limit(4)
      .returns<{ id: string; name: string }[]>(),
  ]);

  return {
    products: (products ?? []).map((product) => ({
      id: product.id,
      name: product.name,
      skuCode: product.sku_code,
      brandName: product.brands?.name,
    })),
    brands: brands ?? [],
    categories: categories ?? [],
  };
}

export async function loadPricedProductsAction(productIds: string[]): Promise<PricedCatalogCard[]> {
  const user = await requirePermission('products.view');
  const safeIds = productIds.filter((id) => UUID_RE.test(id)).slice(0, 20);
  if (safeIds.length === 0) return [];

  const supabase = createClient();
  const [{ data: retailer }, favoriteIds] = await Promise.all([
    supabase.from('retailers').select('area_id').eq('id', user.id).maybeSingle<{ area_id: string }>(),
    loadFavoriteIds(supabase, user.id),
  ]);
  const products = await loadProductsByIds(supabase, safeIds);
  return priceCatalogProducts(supabase, products, user.id, retailer?.area_id ?? null, favoriteIds);
}
