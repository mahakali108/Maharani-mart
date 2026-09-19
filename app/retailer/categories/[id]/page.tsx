import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ChevronLeft, ChevronRight, LayoutGrid, Package } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { requireUser } from '@/lib/auth/session';
import { StoredImage } from '@/components/media/stored-image';
import { loadCategoryDetail } from '@/lib/retailer/category-detail';

export default async function RetailerCategoryDetailPage({ params }: { params: { id: string } }) {
  await requireUser();
  const supabase = createClient();
  const data = await loadCategoryDetail(supabase, params.id);
  if (!data.category) notFound();

  return (
    <div className="space-y-5 sm:space-y-7">
      <div className="flex items-center gap-1.5 text-[10px] font-semibold text-slate-500 sm:text-xs" aria-label="Breadcrumb">
        <Link href="/retailer/home" className="hover:text-primary-600">Home</Link>
        <ChevronRight className="h-3 w-3" aria-hidden="true" />
        <Link href="/retailer/categories" className="hover:text-primary-600">Categories</Link>
        {data.category.parentName ? (
          <>
            <ChevronRight className="h-3 w-3" aria-hidden="true" />
            <span className="text-slate-800">{data.category.parentName}</span>
            <ChevronRight className="h-3 w-3" aria-hidden="true" />
          </>
        ) : null}
        <span className="truncate text-slate-800">{data.category.name}</span>
      </div>

      <Link
        href="/retailer/categories"
        className="inline-flex min-h-11 items-center gap-1.5 rounded-lg text-xs font-bold text-primary-700 transition hover:text-primary-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-300"
      >
        <ChevronLeft className="h-4 w-4" aria-hidden="true" /> All categories
      </Link>

      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
        <div className="relative h-36 bg-slate-50 sm:h-44">
          {data.category.image_url ? (
            <StoredImage
              src={data.category.image_url}
              alt={data.category.name}
              fill
              sizes="(max-width: 640px) 100vw, 768px"
              fallback={
                <div className="flex h-full items-center justify-center text-primary-500">
                  <LayoutGrid className="h-10 w-10" aria-hidden="true" />
                </div>
              }
              className="object-cover"
            />
          ) : (
            <div className="flex h-full items-center justify-center text-primary-500">
              <span className="flex h-16 w-16 items-center justify-center rounded-2xl bg-white shadow-sm">
                <LayoutGrid className="h-7 w-7" aria-hidden="true" />
              </span>
            </div>
          )}
        </div>
        <div className="space-y-4 p-4 sm:p-5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h1 className="break-words text-xl font-bold tracking-tight text-slate-950 sm:text-2xl">{data.category.name}</h1>
              {data.productCount != null ? (
                <p className="mt-1 flex items-center gap-1.5 text-xs text-slate-600">
                  <Package className="h-3.5 w-3.5 text-slate-400" aria-hidden="true" />
                  {data.productCount} product{data.productCount === 1 ? '' : 's'}
                  {data.subcategories.length > 0 ? ' across this aisle' : ''}
                </p>
              ) : (
                <p className="mt-1 text-xs text-slate-500">Product details could not be loaded right now.</p>
              )}
            </div>
          </div>
          <Link
            href={`/retailer/catalog?category=${data.category.id}`}
            className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-primary-600 px-4 text-xs font-bold text-white shadow-sm transition hover:bg-primary-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-300 focus-visible:ring-offset-2"
          >
            View all products <ChevronRight className="h-4 w-4" aria-hidden="true" />
          </Link>
        </div>
      </section>

      {data.subcategories.length > 0 ? (
        <section aria-label="Subcategories" className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-100 px-4 py-3.5 sm:px-5">
            <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-primary-600">Browse deeper</p>
            <h2 className="mt-0.5 text-base font-bold text-slate-900">Subcategories</h2>
          </div>
          <ul className="divide-y divide-slate-100">
            {data.subcategories.map((sub) => (
              <li key={sub.id}>
                <Link
                  href={`/retailer/categories/${sub.id}`}
                  className="flex min-h-14 items-center gap-3 px-4 py-3 transition hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary-300 sm:px-5"
                >
                  <span className="relative flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-slate-100 bg-slate-50">
                    {sub.image_url ? (
                      <StoredImage src={sub.image_url} alt={sub.name} fill sizes="44px" fallback={<LayoutGrid className="h-4 w-4 text-primary-500" />} className="object-cover" />
                    ) : (
                      <LayoutGrid className="h-4 w-4 text-primary-500" aria-hidden="true" />
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-bold text-slate-900">{sub.name}</span>
                    {sub.productCount != null ? (
                      <span className="mt-0.5 block text-[10px] text-slate-500">
                        {sub.productCount} product{sub.productCount === 1 ? '' : 's'}
                      </span>
                    ) : null}
                  </span>
                  <ChevronRight className="h-4 w-4 shrink-0 text-slate-300" aria-hidden="true" />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
