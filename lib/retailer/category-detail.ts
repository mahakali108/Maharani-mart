import 'server-only';

import type { createClient } from '@/lib/supabase/server';
import { countFor, loadScopedProductCounts } from '@/lib/retailer/taxonomy-counts';

/**
 * Category browsing for the retailer app.
 *
 * Everything here is a real database relationship:
 *  - the category itself (active rows only),
 *  - its active immediate subcategories (`categories.parent_id`),
 *  - brands that carry at least one ACTIVE product inside the category scope
 *    (the category plus its active children — the same scope convention the
 *    catalog's `?category=` filter and the home category counts use),
 *  - the true active product count for that scope.
 *
 * The reads are PLAIN COLUMNS. This module used to select the taxonomy with an
 * embedded `products ( id )` and filter it with `products.is_active=eq.true`:
 * an embedded-resource filter is not a safe way to count children (it narrows
 * the parent rows as well), and it hid the rows an admin had just created. The
 * counts now come from `loadScopedProductCounts` over real product rows.
 *
 * No counts are invented: a failed read flips the matching error flag and the
 * UI says the data is unavailable instead of showing an estimated number.
 */

interface CategoryRow {
  id: string;
  name: string;
  image_url: string | null;
  parent_id: string | null;
}

interface BrandRow {
  id: string;
  name: string;
  logo_url: string | null;
}

export interface CategoryDetailCategory {
  id: string;
  name: string;
  image_url: string | null;
  /** Name of the parent category, when this is a subcategory. */
  parentName: string | null;
}

export interface CategoryDetailSubcategory {
  id: string;
  name: string;
  image_url: string | null;
  /** Active product count for this subcategory; undefined when unknown. */
  productCount: number | undefined;
}

export interface CategoryDetailBrand {
  id: string;
  name: string;
  logo_url: string | null;
  /** Active products of this brand inside the category scope. */
  productCount: number;
}

export interface CategoryDetailData {
  category: CategoryDetailCategory | null;
  subcategories: CategoryDetailSubcategory[];
  brands: CategoryDetailBrand[];
  /** Active product count for the whole scope; undefined when unknown. */
  productCount: number | undefined;
  errors: { category: boolean; brands: boolean };
}

/**
 * Loads one active category with its subcategories and brands. Returns
 * `category: null` when the id is missing or the category is inactive — the
 * caller renders the not-found state.
 */
export async function loadCategoryDetail(
  supabase: Awaited<ReturnType<typeof createClient>>,
  categoryId: string
): Promise<CategoryDetailData> {
  if (!categoryId) {
    return { category: null, subcategories: [], brands: [], productCount: undefined, errors: { category: true, brands: false } };
  }

  // Plain columns: the category tree and the brand list are independent reads,
  // and neither carries an embedded aggregate or an embedded-resource filter.
  const [categoryResult, brandResult] = await Promise.all([
    supabase
      .from('categories')
      .select('id, name, image_url, parent_id')
      .eq('is_active', true)
      .order('sort_order')
      .returns<CategoryRow[]>(),
    supabase
      .from('brands')
      .select('id, name, logo_url')
      .eq('is_active', true)
      .order('name')
      .returns<BrandRow[]>(),
  ]);

  const errors = { category: !!categoryResult.error, brands: !!brandResult.error };
  const rows = categoryResult.error ? [] : categoryResult.data ?? [];

  const category = rows.find((row) => row.id === categoryId) ?? null;
  if (!category) {
    // Unknown id, or the row is inactive: there is no public category to show.
    return { category: null, subcategories: [], brands: [], productCount: undefined, errors };
  }

  const subcategoryRows = rows.filter((row) => row.parent_id === category.id);
  const scopeIds = [category.id, ...subcategoryRows.map((sub) => sub.id)];

  // Counts of the ACTIVE products inside the scope, from real rows. `null`
  // means the scan did not complete: every count stays unknown rather than
  // becoming a zero.
  const counts = await loadScopedProductCounts(supabase, scopeIds);

  const subcategories = subcategoryRows.map((row) => ({
    id: row.id,
    name: row.name,
    image_url: row.image_url,
    productCount: countFor(counts?.categories ?? null, row.id) ?? undefined,
  }));

  const productCount = counts
    ? scopeIds.reduce((sum, id) => sum + (countFor(counts.categories, id) ?? 0), 0)
    : undefined;

  const brands: CategoryDetailBrand[] = (brandResult.error ? [] : brandResult.data ?? [])
    .map((brand) => {
      const scoped = countFor(counts?.brands ?? null, brand.id);
      return { id: brand.id, name: brand.name, logo_url: brand.logo_url, productCount: scoped ?? 0 };
    })
    .filter((brand) => brand.productCount > 0)
    .sort((a, b) => b.productCount - a.productCount || a.name.localeCompare(b.name));

  const parent = category.parent_id ? rows.find((row) => row.id === category.parent_id) ?? null : null;

  return {
    category: {
      id: category.id,
      name: category.name,
      image_url: category.image_url,
      parentName: parent?.name ?? null,
    },
    subcategories,
    brands,
    productCount,
    errors,
  };
}
