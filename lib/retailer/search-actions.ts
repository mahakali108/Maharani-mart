'use server';

import { buildCanonicalProductName } from '@/lib/retailer/product-name';
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
  await requirePermission('products.view');
  const q = sanitizeSearchTerm(rawQuery);
  if (q.length < 2) return { products: [], brands: [], categories: [] };
  return cachedSearchSuggestions(q, () => loadSearchSuggestions(q));
}

interface PackMatchRow {
  pack_name: string;
  product_id: string;
  products: { id: string; name: string; brands: { name: string } | null } | null;
}

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

  const merged = new Map<string, { id: string; name: string; brandName?: string; variantHint?: string }>();
  for (const product of products ?? []) {
    const canonical = buildCanonicalProductName({
      brandName: product.brands?.name ?? null,
      productName: product.name,
      packName: null,
    });
    merged.set(product.id, { id: product.id, name: canonical, brandName: product.brands?.name ?? undefined });
  }
  for (const match of packMatches ?? []) {
    const parent = match.products;
    if (!parent?.id || merged.has(parent.id)) continue;
    const canonical = buildCanonicalProductName({
      brandName: parent.brands?.name ?? null,
      productName: parent.name,
      packName: match.pack_name,
    });
    merged.set(parent.id, {
      id: parent.id,
      name: canonical,
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
