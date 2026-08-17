import Link from 'next/link';
import Image from 'next/image';
import { notFound } from 'next/navigation';
import {
  ArrowLeft,
  BadgeIndianRupee,
  CheckCircle2,
  ChevronRight,
  ImageOff,
  PackageCheck,
  ReceiptText,
  ShieldCheck,
  Truck,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { requireUser } from '@/lib/auth/session';
import { getProductPriceOverride, resolvePackPrice } from '@/lib/retailer/effective-price';
import { PackSelector } from '@/components/retailer/pack-selector';
import { FavoriteToggle } from '@/components/retailer/favorite-toggle';

interface ProductDetailRow {
  id: string;
  name: string;
  sku_code: string;
  unit: string;
  units_per_case: number;
  gst_percent: number;
  hsn_code: string | null;
  lead_time_days: number;
  is_new_launch: boolean;
  brands: { name: string } | null;
  categories: { id: string; name: string } | null;
  product_images: { id: string; image_url: string; sort_order: number }[];
}

interface PackRow {
  id: string;
  pack_name: string;
  pack_sku_code: string;
  units_per_case: number;
  base_price: number;
  ptr: number | null;
  mrp: number | null;
  moq: number;
}

export default async function ProductDetailPage({ params }: { params: { id: string } }) {
  const user = await requireUser();
  const supabase = createClient();

  const { data: retailer } = await supabase
    .from('retailers')
    .select('area_id')
    .eq('id', user.id)
    .maybeSingle<{ area_id: string }>();

  const [{ data: product }, { data: packData }] = await Promise.all([
    supabase
      .from('products')
      .select('id, name, sku_code, unit, units_per_case, gst_percent, hsn_code, lead_time_days, is_new_launch, brands ( name ), categories ( id, name ), product_images ( id, image_url, sort_order )')
      .eq('id', params.id)
      .eq('is_active', true)
      .maybeSingle<ProductDetailRow>(),
    supabase
      .from('product_packs')
      .select('id, pack_name, pack_sku_code, units_per_case, base_price, ptr, mrp, moq')
      .eq('product_id', params.id)
      .eq('is_active', true)
      .order('sort_order')
      .returns<PackRow[]>(),
  ]);

  if (!product) notFound();

  const [{ data: favoriteRow }, override] = await Promise.all([
    supabase
      .from('retailer_favorites')
      .select('id')
      .eq('retailer_id', user.id)
      .eq('product_id', params.id)
      .maybeSingle<{ id: string }>(),
    getProductPriceOverride(supabase, params.id, user.id, retailer?.area_id ?? null),
  ]);

  const packs = (packData ?? []).map((pack) => ({
    ...pack,
    effectivePrice: resolvePackPrice(pack, override),
  }));
  const images = [...product.product_images].sort((a, b) => a.sort_order - b.sort_order);
  const lowestPrice = packs.length > 0 ? Math.min(...packs.map((pack) => pack.effectivePrice)) : null;
  const startingPack = packs.find((pack) => pack.effectivePrice === lowestPrice) ?? packs[0];
  const discount =
    startingPack?.mrp && lowestPrice !== null && startingPack.mrp > lowestPrice
      ? Math.round(((startingPack.mrp - lowestPrice) / startingPack.mrp) * 100)
      : 0;

  return (
    <div className="space-y-5 sm:space-y-6">
      <nav className="flex items-center gap-1.5 overflow-hidden text-[10px] font-semibold text-slate-500 sm:text-xs" aria-label="Breadcrumb">
        <Link href="/retailer/catalog" className="flex shrink-0 items-center gap-1 hover:text-primary-600"><ArrowLeft className="h-3.5 w-3.5" /> Products</Link>
        {product.categories ? (
          <>
            <ChevronRight className="h-3 w-3 shrink-0" />
            <Link href={`/retailer/catalog?category=${product.categories.id}`} className="shrink-0 hover:text-primary-600">{product.categories.name}</Link>
          </>
        ) : null}
        <ChevronRight className="h-3 w-3 shrink-0" />
        <span className="truncate text-slate-800">{product.name}</span>
      </nav>

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1.05fr)_minmax(380px,0.95fr)] lg:gap-8">
        <div className="space-y-3 lg:sticky lg:top-36">
          <section className="relative overflow-hidden rounded-2xl border border-slate-200 bg-white p-3 shadow-sm sm:p-5">
            <div className="relative aspect-square overflow-hidden rounded-xl bg-gradient-to-br from-slate-50 to-slate-100">
              {images[0] ? (
                <Image
                  src={images[0].image_url}
                  alt={product.name}
                  fill
                  sizes="(max-width: 1024px) 100vw, 52vw"
                  className="object-contain p-5 sm:p-8"
                  unoptimized
                  priority
                />
              ) : (
                <div className="flex h-full flex-col items-center justify-center gap-2 text-slate-300">
                  <ImageOff className="h-12 w-12" />
                  <span className="text-[10px] font-bold uppercase tracking-wider">Product image unavailable</span>
                </div>
              )}
              <div className="absolute left-3 top-3 flex flex-col items-start gap-1.5">
                {discount > 0 ? <span className="rounded-lg bg-emerald-600 px-2.5 py-1.5 text-[10px] font-bold text-white shadow-sm">{discount}% WHOLESALE SAVING</span> : null}
                {product.is_new_launch ? <span className="rounded-lg bg-primary-600 px-2.5 py-1.5 text-[10px] font-bold text-white shadow-sm">NEW LAUNCH</span> : null}
              </div>
              <div className="absolute right-3 top-3"><FavoriteToggle productId={product.id} initialFavorite={!!favoriteRow} compact /></div>
            </div>
          </section>

          {images.length > 1 ? (
            <div className="scrollbar-none flex gap-2 overflow-x-auto">
              {images.map((image, index) => (
                <div key={image.id} className={`relative h-16 w-16 shrink-0 overflow-hidden rounded-xl border bg-white ${index === 0 ? 'border-primary-500 ring-1 ring-primary-500' : 'border-slate-200'}`}>
                  <Image src={image.image_url} alt={`${product.name} view ${index + 1}`} fill className="object-contain p-1" unoptimized />
                </div>
              ))}
            </div>
          ) : null}
        </div>

        <div className="space-y-5">
          <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
            <div className="flex flex-wrap items-center gap-2">
              {product.brands?.name ? <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-slate-600">{product.brands.name}</span> : null}
              <span className="flex items-center gap-1 text-[10px] font-semibold text-emerald-700"><CheckCircle2 className="h-3.5 w-3.5" /> Available to order</span>
            </div>

            <h1 className="mt-3 text-xl font-bold leading-tight tracking-tight text-slate-950 sm:text-3xl">{product.name}</h1>
            <p className="mt-2 font-mono text-[10px] font-medium text-slate-400">SKU: {product.sku_code}</p>

            {lowestPrice !== null ? (
              <div className="mt-5 border-y border-slate-100 py-4">
                <p className="text-[9px] font-bold uppercase tracking-wider text-slate-400">Wholesale price from</p>
                <div className="mt-1 flex flex-wrap items-baseline gap-2">
                  <p className="text-3xl font-bold tracking-tight text-slate-950">₹{lowestPrice.toFixed(2)}</p>
                  {startingPack?.mrp && startingPack.mrp > lowestPrice ? <p className="text-sm text-slate-400 line-through">MRP ₹{startingPack.mrp.toFixed(2)}</p> : null}
                  {discount > 0 ? <span className="text-xs font-bold text-emerald-700">Save {discount}%</span> : null}
                </div>
                <p className="mt-1 text-[10px] text-slate-500">for {startingPack?.pack_name} · GST {product.gst_percent}% extra</p>
              </div>
            ) : null}

            <dl className="mt-4 grid grid-cols-2 gap-3 text-xs">
              <div className="rounded-xl bg-slate-50 p-3"><dt className="text-[9px] font-bold uppercase tracking-wide text-slate-400">Base unit</dt><dd className="mt-1 font-semibold capitalize text-slate-800">{product.unit}</dd></div>
              <div className="rounded-xl bg-slate-50 p-3"><dt className="text-[9px] font-bold uppercase tracking-wide text-slate-400">Standard case</dt><dd className="mt-1 font-semibold text-slate-800">{product.units_per_case} unit(s)</dd></div>
              <div className="rounded-xl bg-slate-50 p-3"><dt className="text-[9px] font-bold uppercase tracking-wide text-slate-400">GST</dt><dd className="mt-1 font-semibold text-slate-800">{product.gst_percent}%</dd></div>
              <div className="rounded-xl bg-slate-50 p-3"><dt className="text-[9px] font-bold uppercase tracking-wide text-slate-400">HSN code</dt><dd className="mt-1 font-semibold text-slate-800">{product.hsn_code ?? '—'}</dd></div>
            </dl>
          </section>

          {packs.length > 0 ? (
            <PackSelector packs={packs} gstPercent={product.gst_percent} />
          ) : (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-xs font-medium text-amber-800">No pack sizes are currently available for this product.</div>
          )}
        </div>
      </div>

      <section className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:grid-cols-4 sm:p-5">
        {[
          { icon: BadgeIndianRupee, title: 'Approved pricing', body: 'Your retailer or area price is applied.' },
          { icon: PackageCheck, title: 'MOQ protected', body: 'Minimum quantities validated securely.' },
          { icon: ReceiptText, title: 'GST ready', body: `${product.gst_percent}% GST shown before checkout.` },
          { icon: Truck, title: 'Order tracking', body: `Typical lead time: ${product.lead_time_days} day(s).` },
        ].map((item) => (
          <div key={item.title} className="flex items-start gap-3 rounded-xl bg-slate-50 p-3">
            <item.icon className="mt-0.5 h-4 w-4 shrink-0 text-primary-600" />
            <div><p className="text-[11px] font-bold text-slate-800">{item.title}</p><p className="mt-0.5 text-[9px] leading-4 text-slate-500">{item.body}</p></div>
          </div>
        ))}
      </section>

      <div className="flex items-center justify-center gap-2 text-[10px] text-slate-400"><ShieldCheck className="h-3.5 w-3.5" /> Pricing, MOQ and availability are rechecked when you place the order.</div>
    </div>
  );
}
