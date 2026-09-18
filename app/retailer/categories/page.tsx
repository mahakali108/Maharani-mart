import Link from 'next/link';
import { ChevronRight, LayoutGrid } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { requireUser } from '@/lib/auth/session';
import {
  CategoryDirectory,
  type DirectoryBrand,
  type DirectoryCategory,
} from '@/components/retailer/category-directory';
import { categoryScopeIds, loadCategoryBrandCounts, orderBrandsByCount } from '@/lib/retailer/catalog-taxonomy';

interface CategoryRow {
  id: string;
  name: string;
  image_url: string | null;
  parent_id: string | null;
  products: { count: number }[] | null;
}

interface BrandRow {
  id: string;
  name: string;
  logo_url: string | null;
}

/**
 * Shop by category, with the brand step the mobile flow needs:
 *
 *   /retailer/categories                → every active root category
 *   /retailer/categories?category=<id>  → the brands that really have active
 *                                         products in that category
 *
 * Only active categories and active brands are ever read, and a brand only
 * appears when it has at least one active product inside the selected
 * category scope (parent category + its active immediate children — the same
 * scope the catalog filter uses). Products with no brand are simply not
 * browsable by brand; nothing is invented to fill the list.
 */
export default async function CategoriesPage({
  searchParams,
}: {
  searchParams: { category?: string };
}) {
  await requireUser();
  const supabase = createClient();
  const { data } = await supabase
    .from('categories')
    .select('id, name, image_url, parent_id, products(count)')
    .eq('is_active', true)
    .order('sort_order')
    .returns<CategoryRow[]>();

  const categories = (data ?? []).map((category) => ({
    ...category,
    productCount: category.products?.[0]?.count ?? 0,
  }));
  const parents = categories.filter((category) => !category.parent_id);
  const rootCategories = parents.length > 0 ? parents : categories;
  const directoryCategories: DirectoryCategory[] = rootCategories.map((category) => ({
    id: category.id,
    name: category.name,
    image_url: category.image_url,
    productCount: category.productCount,
    children: categories
      .filter((child) => child.parent_id === category.id)
      .map((child) => ({
        id: child.id,
        name: child.name,
        image_url: child.image_url,
        productCount: child.productCount,
      })),
  }));

  const selectedId = searchParams.category?.trim() ?? '';
  const selectedCategory =
    categories.find((category) => category.id === selectedId) ?? null;

  // Brand list for the selected category only — one bounded read instead of
  // shipping every brand in the database to the phone.
  let brands: DirectoryBrand[] = [];
  let brandsCapped = false;
  if (selectedCategory) {
    const scope = categoryScopeIds(categories, selectedCategory.id);
    const { counts, capped } = await loadCategoryBrandCounts(supabase, scope);
    brandsCapped = capped;
    const brandIds = [...counts.keys()];
    if (brandIds.length > 0) {
      const { data: brandRows } = await supabase
        .from('brands')
        .select('id, name, logo_url')
        .eq('is_active', true)
        .in('id', brandIds)
        .returns<BrandRow[]>();
      brands = orderBrandsByCount(brandRows ?? [], counts).map(({ brand, count }) => ({
        id: brand.id,
        name: brand.name,
        logo_url: brand.logo_url,
        productCount: count,
      }));
    }
  }

  const selected = selectedCategory
    ? {
        id: selectedCategory.id,
        name: selectedCategory.name,
        image_url: selectedCategory.image_url,
        productCount: selectedCategory.productCount,
        children: categories
          .filter((child) => child.parent_id === selectedCategory.id)
          .map((child) => ({
            id: child.id,
            name: child.name,
            image_url: child.image_url,
            productCount: child.productCount,
          })),
      }
    : null;

  return (
    <div className="space-y-4 sm:space-y-6">
      <div className="flex flex-wrap items-center gap-1.5 text-[11px] font-semibold text-slate-500 sm:text-xs">
        <Link href="/retailer/home" className="hover:text-primary-600">
          Home
        </Link>
        <ChevronRight className="h-3 w-3" />
        {selected ? (
          <>
            <Link href="/retailer/categories" className="hover:text-primary-600">
              Categories
            </Link>
            <ChevronRight className="h-3 w-3" />
            <span className="text-slate-800">{selected.name}</span>
          </>
        ) : (
          <span className="text-slate-800">Categories</span>
        )}
      </div>

      {!selected ? (
        <section className="rounded-2xl border border-slate-200 bg-gradient-to-br from-primary-50 via-white to-rose-50/50 p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)] sm:p-6">
          <div className="flex items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary-600 text-white shadow-sm sm:h-11 sm:w-11">
              <LayoutGrid className="h-5 w-5" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-primary-600">Browse the catalog</p>
              <h1 className="mt-0.5 text-lg font-bold tracking-tight text-slate-950 sm:text-2xl">Shop by category</h1>
              <p className="mt-1 max-w-2xl text-[11px] leading-5 text-slate-600 sm:text-sm">
                Pick an aisle, then choose a brand to narrow it down.
              </p>
            </div>
          </div>
        </section>
      ) : null}

      {directoryCategories.length > 0 ? (
        <CategoryDirectory
          categories={directoryCategories}
          brands={brands}
          selectedCategory={selected}
          brandsCapped={brandsCapped}
        />
      ) : (
        <section className="flex min-h-[280px] flex-col items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-white px-5 text-center">
          <LayoutGrid className="h-8 w-8 text-slate-300" aria-hidden="true" />
          <p className="mt-3 text-sm font-semibold text-slate-700">No categories yet</p>
          <p className="mt-1 text-xs text-slate-500">
            Categories will appear as the marketplace catalog is updated.
          </p>
        </section>
      )}
    </div>
  );
}
