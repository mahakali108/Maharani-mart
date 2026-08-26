import Link from 'next/link';
import { BadgeCheck, ChevronRight } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { requireUser } from '@/lib/auth/session';
import { BrandDirectory } from '@/components/retailer/brand-directory';
import type { BrandCardData } from '@/components/retailer/brand-card';

interface BrandRow extends BrandCardData {
  products: { count: number }[] | null;
}

export default async function RetailerBrandsPage() {
  await requireUser();
  const supabase = createClient();
  const { data } = await supabase
    .from('brands')
    .select('id, name, logo_url, products(count)')
    .eq('is_active', true)
    .order('name')
    .returns<BrandRow[]>();

  const brands: BrandCardData[] = (data ?? []).map((brand) => ({
    id: brand.id,
    name: brand.name,
    logo_url: brand.logo_url,
    productCount: brand.products?.[0]?.count ?? 0,
  }));

  return (
    <div className="space-y-5 sm:space-y-7">
      <div className="flex items-center gap-1.5 text-[10px] font-semibold text-slate-500 sm:text-xs">
        <Link href="/retailer/home" className="hover:text-primary-600">Home</Link>
        <ChevronRight className="h-3 w-3" />
        <span className="text-slate-800">Brands</span>
      </div>

      <section className="rounded-2xl border border-blue-100 bg-gradient-to-r from-blue-50 via-white to-slate-50 p-5 sm:p-7">
        <div className="flex items-start gap-4">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-blue-600 text-white shadow-sm">
            <BadgeCheck className="h-5 w-5" />
          </span>
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-primary-600">Trusted wholesale partners</p>
            <h1 className="mt-1 text-xl font-bold tracking-tight text-slate-950 sm:text-3xl">Shop by brand</h1>
            <p className="mt-1 max-w-2xl text-xs leading-5 text-slate-600 sm:text-sm">
              Select a brand to open the existing product catalog with that brand&apos;s products and your retailer pricing.
            </p>
          </div>
        </div>
      </section>

      {brands.length > 0 ? (
        <BrandDirectory brands={brands} />
      ) : (
        <section className="flex min-h-[280px] flex-col items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-white px-5 text-center">
          <BadgeCheck className="h-8 w-8 text-slate-300" />
          <p className="mt-3 text-sm font-semibold text-slate-700">No brands yet</p>
          <p className="mt-1 text-xs text-slate-500">Brands will appear as products are added to the marketplace.</p>
        </section>
      )}
    </div>
  );
}
