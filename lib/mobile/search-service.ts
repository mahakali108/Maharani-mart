import 'server-only';

/**
 * Cross-entity search suggestions for the native app
 * (`GET /api/mobile/v1/catalog/search?q=…`).
 *
 * WHY THIS EXISTS
 * The web storefront's search box answers with PRODUCTS, BRANDS and CATEGORIES
 * at once (`lib/retailer/search-actions.ts` → `loadSearchSuggestions`). That
 * helper is a `'use server'` action: it authenticates from the browser cookie
 * and opens its own client, so the bearer-token native app cannot call it. The
 * mobile catalogue only had `GET /catalog/products?q=`, which matches products —
 * so a retailer typing a brand name or a category name into the native search
 * field got "no products found" instead of the brand/category the storefront
 * would have offered. That is the gap this module closes.
 *
 * WHAT IT DOES — and nothing more
 * It runs the SAME four reads the web suggestion loader runs, against the
 * CALLER's own RLS-scoped client:
 *   1. active products matching the term in `name` or `barcode`;
 *   2. active packs matching the term in `pack_name` or `barcode` (a pack
 *      barcode is the number on a 500 g sachet, which is what a shopkeeper
 *      actually scans — the product-level barcode is the carton's);
 *   3. active brands matching the term in `name`;
 *   4. active categories matching the term in `name`.
 * Pack matches are folded onto their parent product exactly as the web loader
 * folds them, and the display name is built by the one canonical-name helper the
 * whole product uses (`buildCanonicalProductName`), so a suggestion can never
 * show a name the product page would contradict.
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 *   - it returns NO price, NO stock and NO MOQ. A suggestion is a navigation
 *     affordance; the moment a shopper opens it, the priced catalogue row /
 *     product detail answer with today's server-resolved numbers. Suggesting a
 *     rate here would be a second, stale source of truth.
 *   - it does not rank, fuzzy-match or invent "popular searches". There is no
 *     popularity table in this backend, and the results are ordered by `name`
 *     so two retailers typing the same term see the same order.
 *   - it never accepts a retailer id, area id or role: identity comes from the
 *     verified bearer session, and every query below runs under that token's
 *     RLS policies.
 *
 * A failed read THROWS. An empty term is not a failure — it is a normal "nothing
 * to suggest yet", and the route answers empty lists so the app can keep showing
 * recent searches. Conflating the two is exactly the bug the catalogue panes
 * already had to fix (`loadTaxonomyScope`), so the distinction is kept here too.
 */

import type { createClient } from '@/lib/supabase/server';
import { buildCanonicalProductName } from '@/lib/retailer/product-name';
import { sanitizeSearchTerm } from '@/lib/retailer/catalog-params';
import { resolveMediaUrl } from '@/lib/media/refs';
import type { MobileSession } from '@/lib/mobile/auth';

type SupabaseClient = ReturnType<typeof createClient>;

/** The caller's RLS-scoped client, typed the way `lib/retailer/*` expects. */
function retailerSupabase(session: MobileSession): SupabaseClient {
  return session.supabase as unknown as SupabaseClient;
}

/**
 * The shortest term worth querying.
 *
 * Two characters, the same floor the web loader uses: a single letter matches
 * most of the catalogue and tells a shopper nothing.
 */
export const MOBILE_SEARCH_MIN_TERM = 2;

/** Caps per entity, the web loader's own (6 products, 4 brands, 4 categories). */
export const MOBILE_SEARCH_PRODUCT_LIMIT = 6;
export const MOBILE_SEARCH_BRAND_LIMIT = 4;
export const MOBILE_SEARCH_CATEGORY_LIMIT = 4;

/** Which column the match came from, so the UI can say "Barcode" honestly. */
export type MobileSearchMatchKind = 'name' | 'barcode' | 'pack';

export interface MobileSearchProduct {
  id: string;
  /** Canonical display name: brand + product + variant, built server-side. */
  name: string;
  brandName: string | null;
  /** The variant/pack name, when a PACK (not the product) matched the term. */
  packName: string | null;
  imageUrl: string | null;
  matchKind: MobileSearchMatchKind;
}

export interface MobileSearchBrand {
  id: string;
  name: string;
  logoUrl: string | null;
}

export interface MobileSearchCategory {
  id: string;
  name: string;
  /** The parent category's name, or null for a parent / an unresolvable link. */
  parentName: string | null;
}

export interface MobileSearchSuggestions {
  /** The sanitized term actually matched, echoed so the client can drop a stale answer. */
  query: string;
  /** False when the term was shorter than [MOBILE_SEARCH_MIN_TERM]; no query ran. */
  searched: boolean;
  products: MobileSearchProduct[];
  brands: MobileSearchBrand[];
  categories: MobileSearchCategory[];
}

interface ProductSuggestionRow {
  id: string;
  name: string;
  barcode: string | null;
  brands: { name: string } | null;
  product_images: { image_url: string; sort_order: number }[];
}

interface PackSuggestionRow {
  pack_name: string;
  barcode: string | null;
  product_id: string;
  products: {
    id: string;
    name: string;
    barcode: string | null;
    brands: { name: string } | null;
    product_images: { image_url: string; sort_order: number }[];
  } | null;
}

interface BrandSuggestionRow {
  id: string;
  name: string;
  logo_url: string | null;
}

interface CategorySuggestionRow {
  id: string;
  name: string;
  parent_id: string | null;
}

/** The first usable image of a product row, in the gallery's own order. */
function firstImage(row: { product_images: { image_url: string; sort_order: number }[] } | null): string | null {
  const images = [...(row?.product_images ?? [])].sort((a, b) => a.sort_order - b.sort_order);
  return resolveMediaUrl(images[0]?.image_url ?? null);
}

function termMatches(term: string, value: string | null | undefined): boolean {
  return (value ?? '').toLowerCase().includes(term);
}

/**
 * Resolve the parent names of the matched categories.
 *
 * A second, tiny `in` query rather than a PostgREST self-join: the taxonomy is
 * small, the join hint name is not guaranteed to be stable, and an unreadable
 * parent must degrade to `parentName: null` — never to a wrong parent or a
 * failed search.
 */
async function resolveParentNames(
  supabase: SupabaseClient,
  rows: CategorySuggestionRow[]
): Promise<Map<string, string>> {
  const parentIds = [...new Set(rows.map((row) => row.parent_id).filter((id): id is string => Boolean(id)))];
  if (parentIds.length === 0) return new Map();
  try {
    const { data, error } = await supabase
      .from('categories')
      .select('id, name')
      .in('id', parentIds)
      .returns<{ id: string; name: string }[]>();
    if (error) return new Map();
    return new Map((data ?? []).map((row) => [row.id, row.name]));
  } catch {
    return new Map();
  }
}

/**
 * Run the four suggestion reads for one sanitized term.
 *
 * @throws when a product, pack, brand or category read fails. The route turns
 *   that into a 503 with a retry — never into "no results".
 */
export async function loadMobileSearchSuggestions(
  session: MobileSession,
  rawQuery: string
): Promise<MobileSearchSuggestions> {
  const term = sanitizeSearchTerm(rawQuery);
  const lowered = term.toLowerCase();

  if (term.length < MOBILE_SEARCH_MIN_TERM) {
    return { query: term, searched: false, products: [], brands: [], categories: [] };
  }

  const supabase = retailerSupabase(session);
  const like = `%${term}%`;

  const [productResult, packResult, brandResult, categoryResult] = await Promise.all([
    supabase
      .from('products')
      .select('id, name, barcode, brands ( name ), product_images ( image_url, sort_order )')
      .eq('is_active', true)
      .or(`name.ilike.${like},barcode.ilike.${like}`)
      .order('name')
      .limit(MOBILE_SEARCH_PRODUCT_LIMIT)
      .returns<ProductSuggestionRow[]>(),
    supabase
      .from('product_packs')
      .select('pack_name, barcode, product_id, products ( id, name, barcode, brands ( name ), product_images ( image_url, sort_order ) )')
      .eq('is_active', true)
      .or(`pack_name.ilike.${like},barcode.ilike.${like}`)
      .order('pack_name')
      .limit(MOBILE_SEARCH_PRODUCT_LIMIT)
      .returns<PackSuggestionRow[]>(),
    supabase
      .from('brands')
      .select('id, name, logo_url')
      .eq('is_active', true)
      .ilike('name', like)
      .order('name')
      .limit(MOBILE_SEARCH_BRAND_LIMIT)
      .returns<BrandSuggestionRow[]>(),
    supabase
      .from('categories')
      .select('id, name, parent_id')
      .eq('is_active', true)
      .ilike('name', like)
      .order('name')
      .limit(MOBILE_SEARCH_CATEGORY_LIMIT)
      .returns<CategorySuggestionRow[]>(),
  ]);

  // A failed taxonomy/product read is a FAILURE, not an empty suggestion list:
  // reporting "no match" for a term the shop does stock is the exact defect the
  // brief calls out ("Never turn API failure into 'No products found'").
  if (productResult.error) throw new Error(`Product search failed: ${productResult.error.message}`);
  if (packResult.error) throw new Error(`Pack search failed: ${packResult.error.message}`);
  if (brandResult.error) throw new Error(`Brand search failed: ${brandResult.error.message}`);
  if (categoryResult.error) throw new Error(`Category search failed: ${categoryResult.error.message}`);

  const merged = new Map<string, MobileSearchProduct>();

  for (const row of productResult.data ?? []) {
    merged.set(row.id, {
      id: row.id,
      name: buildCanonicalProductName({
        brandName: row.brands?.name ?? null,
        productName: row.name,
        packName: null,
      }),
      brandName: row.brands?.name ?? null,
      packName: null,
      imageUrl: firstImage(row),
      // A barcode hit is worth saying: the shopper typed a number and the app
      // found the product behind it, which a plain name match would hide.
      matchKind: termMatches(lowered, row.barcode) && !termMatches(lowered, row.name) ? 'barcode' : 'name',
    });
  }

  for (const row of packResult.data ?? []) {
    const parent = row.products;
    if (!parent?.id || merged.has(parent.id)) continue;
    const packBarcodeHit = termMatches(lowered, row.barcode);
    merged.set(parent.id, {
      id: parent.id,
      name: buildCanonicalProductName({
        brandName: parent.brands?.name ?? null,
        productName: parent.name,
        packName: row.pack_name,
      }),
      brandName: parent.brands?.name ?? null,
      packName: row.pack_name,
      imageUrl: firstImage(parent),
      matchKind: packBarcodeHit ? 'barcode' : 'pack',
    });
  }

  const categories = categoryResult.data ?? [];
  const parentNames = await resolveParentNames(supabase, categories);

  return {
    query: term,
    searched: true,
    products: [...merged.values()].slice(0, MOBILE_SEARCH_PRODUCT_LIMIT),
    brands: (brandResult.data ?? []).map((row) => ({
      id: row.id,
      name: row.name,
      logoUrl: resolveMediaUrl(row.logo_url),
    })),
    categories: categories.map((row) => ({
      id: row.id,
      name: row.name,
      parentName: row.parent_id ? parentNames.get(row.parent_id) ?? null : null,
    })),
  };
}
