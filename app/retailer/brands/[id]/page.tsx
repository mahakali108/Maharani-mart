import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ChevronLeft, ChevronRight, Package, Tag } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { getRetailerShoppingContext } from '@/lib/retailer/shopping-context';
import { ProductCard } from '@/components/retailer/product-card';
import { StoredImage } from '@/components/media/stored-image';
import { loadBrandProducts } from '@/lib/retailer/brand-detail';
import { CATALOG_PAGE_SIZE } from '@/lib/retailer/catalog-params';

function BrandMonogram({ name }: { name: string }) {
  const monogram = name
    .split(/\s+/)
    .map((word) => word[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();
  return <span className="text-lg font-black tracking-tight text-primary-700">{monogram || 'B'}</span>;
}

export default async function RetailerBrandDetailPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: { page?: string };
}) {
  const { user, retailer } = await getRetailerShoppingContext();
  const supabase = createClient();
  const page = Math.max(1, parseInt(searchParams.page ?? '1', 10) || 1);
  const data = await loadBrandProducts(
    supabase,
    user.id,
    retailer?.area_id ?? null,
    params.id,
    page,
    !!retailer
  );
  if (!data.brand) notFound();

  const hrefForPage = (target: number) => `/retailer/brands/${data.brand!.id}?page=${target}`;

  return (
    <div className="space-y-5 pb-24 sm:space-y-7 lg:pb-0">
      <div className="flex items-center gap-1.5 text-[10px] font-semibold text-slate-500 sm:text-xs" aria-label="Breadcrumb">
        <Link href="/retailer/home" className="hover:text-primary-600">Home</Link>
        <ChevronRight className="h-3 w-3" aria-hidden="true" />
        <Link href="/retailer/brands" className="hover:text-primary-600">Brands</Link>
        <ChevronRight className="h-3 w-3" aria-hidden="true" />
        <span className="truncate text-slate-800">{data.brand.name}</span>
      </div>

      <Link
        href="/retailer/brands"
        className="inline-flex min-h-11 items-center gap-1.5 rounded-lg text-xs font-bold text-primary-700 transition hover:text-primary-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-300"
      >
        <ChevronLeft className="h-4 w-4" aria-hidden="true" /> All brands
      </Link>

      <section className="flex flex-col gap-4 rounded-2xl border border-slate-200 bg-gradient-to-br from-primary-50 via-white to-rose-50/50 p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)] sm:flex-row sm:items-center sm:p-6">
        <span className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-slate-100 bg-white shadow-sm sm:h-20 sm:w-20">
          {data.brand.logo_url ? (
            <StoredImage
              src={data.brand.logo_url}
              alt={`${data.brand.name} logo`}
              fill
              sizes="80px"
              fallback={<BrandMonogram name={data.brand.name} />}
              className="object-contain p-2"
            />
          ) : (
            <BrandMonogram name={data.brand.name} />
          )}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-primary-600">Brand</p>
          <h1 className="mt-1 break-words text-2xl font-bold tracking-tight text-slate-950">{data.brand.name}</h1>
          {data.productCount != null ? (
            <p className="mt-1 flex items-center gap-1.5 text-xs text-slate-600">
              <Package className="h-3.5 w-3.5 text-slate-400" aria-hidden="true" />
              {data.productCount} active product{data.productCount === 1 ? '' : 's'} at your retailer prices
            </p>
          ) : (
            <p className="mt-1 text-xs text-slate-500">Product details could not be loaded right now.</p>
          )}
        </div>
        <Link
          href="/retailer/catalog"
          className="inline-flex min-h-11 w-fit items-center gap-1.5 self-start rounded-xl border border-slate-200 bg-white px-4 text-xs font-bold text-slate-700 transition hover:border-primary-200 hover:text-primary-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-300 sm:self-center"
        >
          <Tag className="h-3.5 w-3.5" aria-hidden="true" /> Full catalog
        </Link>
      </section>

      {data.productCount === 0 ? (
        <section className="flex min-h-[280px] flex-col items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-white px-5 text-center">
          <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-50 text-slate-400">
            <Package className="h-6 w-6" aria-hidden="true" />
          </span>
          <h2 className="mt-4 text-base font-bold text-slate-900">No active products from {data.brand.name} yet</h2>
          <p className="mt-1 max-w-sm text-xs leading-5 text-slate-500">
            Products appear here as soon as they are listed and active. Browse the full catalog in the meantime.
          </p>
          <Link
            href="/retailer/catalog"
            className="mt-5 inline-flex min-h-11 items-center gap-2 rounded-xl bg-primary-600 px-5 text-xs font-bold text-white shadow-sm transition hover:bg-primary-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-300"
          >
            Browse catalog <ChevronRight className="h-4 w-4" aria-hidden="true" />
          </Link>
        </section>
      ) : (
        <section aria-label={`${data.brand.name} products`} className="space-y-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-primary-600">What&apos;s available</p>
              <h2 className="mt-0.5 text-lg font-bold text-slate-900 sm:text-xl">
                {data.brand.name} products
                {data.page > 1 ? ` · page ${data.page}` : ''}
              </h2>
            </div>
          </div>

          {data.errors.pricing ? (
            <p role="status" className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs leading-5 text-amber-800">
              Current pricing could not be loaded. Products are listed below; add-to-cart activates once prices can be verified.
            </p>
          ) : null}
          {data.resultCapped ? (
            <p role="status" className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs leading-5 text-slate-600">
              Showing the first {CATALOG_PAGE_SIZE * (data.totalPages)} products for this brand. Use search in the catalog to find anything beyond.
            </p>
          ) : null}

          <div className="grid grid-cols-2 items-stretch gap-2.5 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4">
            {data.products.map((product) => (
              <ProductCard key={product.id} {...product} />
            ))}
          </div>

          {data.totalPages > 1 ? (
            <nav className="flex items-center justify-center gap-2 pt-2" aria-label="Brand product pages">
              {data.page > 1 ? (
                <Link
                  href={hrefForPage(data.page - 1)}
                  className="flex min-h-11 items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-4 text-xs font-bold text-slate-700 transition hover:border-primary-200 hover:text-primary-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-300"
                >
                  <ChevronLeft className="h-4 w-4" aria-hidden="true" /> Previous
                </Link>
              ) : (
                <span aria-disabled="true" className="flex min-h-11 items-center gap-1.5 rounded-xl border border-slate-100 bg-slate-50 px-4 text-xs font-bold text-slate-300">
                  <ChevronLeft className="h-4 w-4" aria-hidden="true" /> Previous
                </span>
              )}
              <span className="rounded-xl bg-slate-100 px-3 py-2 text-[10px] font-bold text-slate-600">
                Page {data.page} of {data.totalPages}
              </span>
              {data.page < data.totalPages ? (
                <Link
                  href={hrefForPage(data.page + 1)}
                  className="flex min-h-11 items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-4 text-xs font-bold text-slate-700 transition hover:border-primary-200 hover:text-primary-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-300"
                >
                  Next <ChevronRight className="h-4 w-4" aria-hidden="true" />
                </Link>
              ) : (
                <span aria-disabled="true" className="flex min-h-11 items-center gap-1.5 rounded-xl border border-slate-100 bg-slate-50 px-4 text-xs font-bold text-slate-300">
                  Next <ChevronRight className="h-4 w-4" aria-hidden="true" />
                </span>
              )}
            </nav>
          ) : null}
        </section>
      )}
    </div>
  );
}
