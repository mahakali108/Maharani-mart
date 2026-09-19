import 'server-only';

import type { createClient } from '@/lib/supabase/server';

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
 * No counts are invented: a failed read flips the matching error flag and the
 * UI says the data is unavailable instead of showing an estimated number.
 */

interface CategoryRow {
  id: string;
  name: string;
  image_url: string | null;
  parent_id: string | null;
  products: { id: string }[] | null;
}

interface BrandRow {
  id: string;
  name: string;
  logo_url: string | null;
  products: { id: string; category_id: string | null }[] | null;
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
  supabase: ReturnType<typeof createClient>,
  categoryId: string
): Promise<CategoryDetailData> {
  if (!categoryId) {
    return { category: null, subcategories: [], brands: [], productCount: undefined, errors: { category: true, brands: false } };
  }

  const [categoryResult, brandResult] = await Promise.all([
    // Every active category with its active products' ids: one read powers the
    // parent lookup, the subcategory list, and the scoped product counts.
    supabase
      .from('categories')
      .select('id, name, image_url, parent_id, products ( id )')
      .eq('is_active', true)
      .eq('products.is_active', true)
      .order('sort_order')
      .returns<CategoryRow[]>(),
    // Active brands with their active products' category membership.
    supabase
      .from('brands')
      .select('id, name, logo_url, products ( id, category_id )')
      .eq('is_active', true)
      .eq('products.is_active', true)
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

  const subcategories = rows
    .filter((row) => row.parent_id === category.id)
    .map((row) => ({
      id: row.id,
      name: row.name,
      image_url: row.image_url,
      productCount: row.products ? row.products.length : undefined,
    }));

  const scopeIds = new Set<string>([category.id, ...subcategories.map((sub) => sub.id)]);
  const productCount = category.products
    ? category.products.length + subcategories.reduce((sum, sub) => sum + (sub.productCount ?? 0), 0)
    : undefined;

  const brands: CategoryDetailBrand[] = (brandResult.error ? [] : brandResult.data ?? [])
    .map((brand) => {
      const inScope = (brand.products ?? []).filter((product) => product.category_id != null && scopeIds.has(product.category_id));
      return { id: brand.id, name: brand.name, logo_url: brand.logo_url, productCount: inScope.length };
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
