import Link from 'next/link';
import { BadgeCheck, ChevronRight } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { requireUser } from '@/lib/auth/session';
import { BrandDirectory } from '@/components/retailer/brand-directory';
import type { BrandCardData } from '@/components/retailer/brand-card';
import { loadBrandDirectory } from '@/lib/retailer/brand-detail';

export default async function RetailerBrandsPage({
  searchParams,
}: {
  searchParams: { category?: string };
}) {
  await requireUser();
  const supabase = createClient();
  const categoryId = searchParams.category?.trim() ?? '';
  const directory = await loadBrandDirectory(supabase, categoryId || undefined);

  const brands: BrandCardData[] = directory.brands.map((brand) => ({
    id: brand.id,
    name: brand.name,
    logo_url: brand.logo_url,
    productCount: brand.productCount,
  }));
  const selectedCategory = directory.categories.find((category) => category.id === categoryId) ?? null;

  return (
    <div className="space-y-5 sm:space-y-7">
      <div className="flex items-center gap-1.5 text-[10px] font-semibold text-slate-500 sm:text-xs">
        <Link href="/retailer/home" className="hover:text-primary-600">
          Home
        </Link>
        <ChevronRight className="h-3 w-3" />
        <span className="text-slate-800">Brands</span>
      </div>

      <section className="rounded-2xl border border-slate-200 bg-gradient-to-br from-primary-50 via-white to-rose-50/50 p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)] sm:p-7">
        <div className="flex items-start gap-4">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary-600 text-white shadow-sm">
            <BadgeCheck className="h-5 w-5" aria-hidden="true" />
          </span>
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-primary-600">Trusted brands</p>
            <h1 className="mt-1 text-xl font-bold tracking-tight text-slate-950 sm:text-2xl">Shop by brand</h1>
            <p className="mt-1 max-w-2xl text-xs leading-5 text-slate-600 sm:text-sm">
              Pick a brand to see every active product at your retailer pricing.
            </p>
          </div>
        </div>
      </section>

      {directory.categories.length > 0 ? (
        <form action="/retailer/brands" method="get" className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <label className="relative flex-1">
            <span className="sr-only">Filter brands by category</span>
            <select
              name="category"
              defaultValue={selectedCategory?.id ?? ''}
              className="h-12 w-full appearance-none rounded-xl border border-slate-200 bg-white px-4 pr-10 text-sm font-semibold text-slate-900 outline-none focus:border-primary-300 focus:ring-4 focus:ring-primary-50"
            >
              <option value="">All categories</option>
              {directory.categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>
          </label>
          <div className="flex gap-2">
            <button
              type="submit"
              className="flex h-12 min-w-[5.5rem] flex-1 items-center justify-center rounded-xl bg-primary-600 px-4 text-xs font-bold text-white shadow-sm transition hover:bg-primary-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-300 sm:flex-none"
            >
              Filter
            </button>
            {selectedCategory ? (
              <Link
                href="/retailer/brands"
                className="flex h-12 flex-1 items-center justify-center rounded-xl border border-slate-200 bg-white px-4 text-xs font-bold text-slate-700 transition hover:border-primary-200 hover:text-primary-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-300 sm:flex-none"
              >
                Clear
              </Link>
            ) : null}
          </div>
        </form>
      ) : null}

      {selectedCategory ? (
        <p className="text-[11px] text-slate-500" role="status">
          Showing brands with active products in <span className="font-bold text-slate-700">{selectedCategory.name}</span>.
        </p>
      ) : null}

      {brands.length > 0 ? (
        <BrandDirectory brands={brands} />
      ) : (
        <section className="flex min-h-[280px] flex-col items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-white px-5 text-center">
          <BadgeCheck className="h-8 w-8 text-slate-300" aria-hidden="true" />
          <p className="mt-3 text-sm font-semibold text-slate-700">
            {selectedCategory ? `No brands in ${selectedCategory.name} yet` : 'No brands yet'}
          </p>
          <p className="mt-1 max-w-sm text-xs leading-5 text-slate-500">
            {selectedCategory
              ? 'Products with a listed brand appear here. Browse the category directly to see everything available.'
              : 'Brands will appear as products are added to the marketplace.'}
          </p>
          {selectedCategory ? (
            <Link
              href={`/retailer/catalog?category=${selectedCategory.id}`}
              className="mt-5 inline-flex min-h-11 items-center gap-2 rounded-xl bg-primary-600 px-5 text-xs font-bold text-white shadow-sm transition hover:bg-primary-700"
            >
              Browse this category <ChevronRight className="h-4 w-4" aria-hidden="true" />
            </Link>
          ) : null}
        </section>
      )}
    </div>
  );
}
