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
  products: { id: string; name: string; brandName?: string; variantHint?: string }[];
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

/** A product matched through one of its variants (pack size) or its barcode. */
interface PackMatchRow {
  pack_name: string;
  product_id: string;
  products: { id: string; name: string; brands: { name: string } | null } | null;
}

/**
 * The authoritative Supabase read behind the suggestions dropdown.
 *
 * Matches every real, retailer-visible field: product NAME, BRAND, CATEGORY,
 * product/pack BARCODE (EAN/UPC) and the VARIANT/SIZE itself — a pack's
 * `pack_name` IS the size ("50g", "100g", "5L Jar"), so typing a size surfaces
 * the products that sell it. Internal SKU codes are deliberately not a search
 * field and are never returned.
 *
 * All four queries are selective-column, `is_active`-scoped and hard-limited,
 * so the dropdown never pulls the catalog into the browser. RLS keeps inactive
 * packs and other retailers' data out of the match set.
 */
async function loadSearchSuggestions(q: string): Promise<SearchSuggestionResult> {
  const supabase = createClient();
  const like = `"%${q}%"`;

  const [{ data: products }, { data: packMatches }, { data: brands }, { data: categories }] = await Promise.all([
    supabase
      .from('products')
      .select('id, name, brands ( name )')
      .eq('is_active', true)
      .or(`name.ilike.${like},barcode.ilike.${like}`)
      .order('name')
      .limit(6)
      .returns<{ id: string; name: string; brands: { name: string } | null }[]>(),
    // The parent product's name/brand is embedded here on purpose: it means a
    // size or barcode hit needs no second round trip to become a suggestion.
    supabase
      .from('product_packs')
      .select('pack_name, product_id, products ( id, name, brands ( name ) )')
      .eq('is_active', true)
      .or(`pack_name.ilike.${like},barcode.ilike.${like}`)
      .limit(6)
      .returns<PackMatchRow[]>(),
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

  // Name/barcode hits first (the retailer typed a product), then size/barcode
  // hits that are not already listed, each labelled with the size that matched.
  const merged = new Map<string, { id: string; name: string; brandName?: string; variantHint?: string }>();
  for (const product of products ?? []) {
    merged.set(product.id, { id: product.id, name: product.name, brandName: product.brands?.name ?? undefined });
  }
  for (const match of packMatches ?? []) {
    const parent = match.products;
    if (!parent?.id || merged.has(parent.id)) continue;
    merged.set(parent.id, {
      id: parent.id,
      name: parent.name,
      brandName: parent.brands?.name ?? undefined,
      variantHint: match.pack_name,
    });
  }

  return {
    products: [...merged.values()].slice(0, 6),
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
