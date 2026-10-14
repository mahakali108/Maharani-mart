import { CatalogueNav } from '@/components/retailer/catalogue-nav';
import Link from 'next/link';
import { BadgeCheck, ChevronRight, LayoutGrid } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { requireUser } from '@/lib/auth/session';
import { BrandDirectory } from '@/components/retailer/brand-directory';
import type { BrandCardData } from '@/components/retailer/brand-card';
import { CategoryDirectory, type DirectoryCategory } from '@/components/retailer/category-directory';
import { countFor, loadTaxonomyProductCounts } from '@/lib/retailer/taxonomy-counts';

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

export default async function CategoriesPage() {
  await requireUser();
  const supabase = createClient();
  // Load both independent catalog dimensions together. The brand count comes
  // from the existing brands → active products relationship; no category
  // filter is applied, so brands remain an independent browse dimension.
  const [{ data: categoryData }, { data: brandData }, taxonomyCounts] = await Promise.all([
    // Plain columns only. The `products(count)` aggregate this query used to
    // carry is an opt-in PostgREST feature: where it is disabled the WHOLE read
    // fails, so an admin-created category or brand never appeared here.
    supabase
      .from('categories')
      .select('id, name, image_url, parent_id')
      .eq('is_active', true)
      .order('sort_order')
      .returns<CategoryRow[]>(),
    // No filter on the embedded resource either: `products.is_active=eq.true`
    // narrows (or inner-joins) the PARENT rows, which hid a brand that has no
    // active product yet — exactly the brand an admin just created.
    supabase
      .from('brands')
      .select('id, name, logo_url')
      .eq('is_active', true)
      .order('name')
      .returns<BrandRow[]>(),
    loadTaxonomyProductCounts(supabase),
  ]);

  const categories = (categoryData ?? []).map((category) => ({
    ...category,
    // Unknown stays unknown: a scan that could not complete is never a zero.
    productCount: countFor(taxonomyCounts?.categories ?? null, category.id) ?? undefined,
  }));
  const brands: BrandCardData[] = (brandData ?? []).map((brand) => ({
    id: brand.id,
    name: brand.name,
    logo_url: brand.logo_url,
    productCount: countFor(taxonomyCounts?.brands ?? null, brand.id) ?? undefined,
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

  return (
    <div className="space-y-5 sm:space-y-7">
      <CatalogueNav active="categories" />
      <div className="flex items-center gap-1.5 text-[10px] font-semibold text-slate-500 sm:text-xs">
        <Link href="/retailer/home" className="hover:text-primary-600">
          Home
        </Link>
        <ChevronRight className="h-3 w-3" />
        <span className="text-slate-800">Categories</span>
      </div>

      <section className="rounded-2xl border border-slate-200 bg-lavender-50 p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)] sm:p-7">
        <div className="flex items-start gap-4">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary-600 text-white shadow-sm">
            <LayoutGrid className="h-5 w-5" aria-hidden="true" />
          </span>
          <div className="min-w-0">
          <p className="shop-eyebrow">Browse the catalog</p>
            <h1 className="shop-heading mt-1 font-semibold tracking-tight text-slate-950">Shop by category</h1>
            <p className="mt-1 max-w-2xl text-xs leading-5 text-slate-600 sm:text-sm">
              Explore product aisles and open the catalog with your category already selected.
            </p>
          </div>
        </div>
      </section>

      <section aria-labelledby="categories-heading" className="space-y-3">
        <div className="flex items-end justify-between gap-3">
          <div>
            <p className="shop-eyebrow">Catalog directory</p>
            <h2 id="categories-heading" className="mt-0.5 text-lg font-bold tracking-tight text-slate-950 sm:text-xl">Categories</h2>
          </div>
        </div>
        {directoryCategories.length > 0 ? (
          <CategoryDirectory categories={directoryCategories} />
        ) : (
          <section className="flex min-h-[280px] flex-col items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-white px-5 text-center">
            <LayoutGrid className="h-8 w-8 text-slate-300" aria-hidden="true" />
            <p className="mt-3 text-sm font-semibold text-slate-700">No categories yet</p>
            <p className="mt-1 text-xs text-slate-500">
              Categories will appear as the marketplace catalog is updated.
            </p>
          </section>
        )}
      </section>

      <section aria-labelledby="brands-heading" className="space-y-3">
        <div>
          <p className="shop-eyebrow">Catalog directory</p>
          <h2 id="brands-heading" className="mt-0.5 flex items-center gap-2 text-lg font-bold tracking-tight text-slate-950 sm:text-xl">
            <BadgeCheck className="h-5 w-5 text-primary-600" aria-hidden="true" />
            Brands
          </h2>
        </div>
        {brands.length > 0 ? (
          <BrandDirectory brands={brands} />
        ) : (
          <section className="flex min-h-[220px] flex-col items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-white px-5 text-center">
            <BadgeCheck className="h-8 w-8 text-slate-300" aria-hidden="true" />
            <p className="mt-3 text-sm font-semibold text-slate-700">No brands yet</p>
            <p className="mt-1 text-xs text-slate-500">Brands will appear as products are added to the marketplace.</p>
          </section>
        )}
      </section>
    </div>
  );
}
