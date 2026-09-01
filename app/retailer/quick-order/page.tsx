import Link from 'next/link';
import {
  ArrowRight,
  Barcode,
  CheckCircle2,
  ChevronRight,
  PackageSearch,
  Search,
  ShieldCheck,
  ShoppingCart,
  Sparkles,
  Zap,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { requireUser } from '@/lib/auth/session';
import { getProductPriceOverrides, resolvePackPrice } from '@/lib/retailer/effective-price';
import { sanitizeSearchTerm } from '@/lib/retailer/catalog-params';
import { QuickOrderRow, type QuickOrderPack } from '@/components/retailer/quick-order-row';

interface QuickOrderProductRow {
  id: string;
  name: string;
  gst_percent: number;
  brands: { name: string } | null;
  product_images: { image_url: string; sort_order: number }[];
  product_packs: {
    id: string;
    pack_name: string;
    units_per_case: number;
    base_price: number;
    ptr: number | null;
    case_price: number;
    mrp: number | null;
    moq: number;
    is_active: boolean;
  }[];
}

const MAX_RESULTS = 30;

export default async function QuickOrderPage({ searchParams }: { searchParams: { q?: string } }) {
  const user = await requireUser();
  const supabase = createClient();
  const q = sanitizeSearchTerm(searchParams.q ?? '');

  const { data: retailer } = await supabase
    .from('retailers')
    .select('area_id')
    .eq('id', user.id)
    .maybeSingle<{ area_id: string }>();

  let cards: {
    id: string;
    name: string;
    brandName?: string;
    imageUrl?: string;
    gstPercent: number;
    packs: QuickOrderPack[];
  }[] = [];

  if (q) {
    const { data: productRows } = await supabase
      .from('products')
      .select('id, name, gst_percent, brands ( name ), product_images ( image_url, sort_order ), product_packs ( id, pack_name, units_per_case, base_price, ptr, case_price, mrp, moq, is_active )')
      .eq('is_active', true)
      .ilike('name', `"%${q}%"`)
      .order('name')
      .limit(MAX_RESULTS)
      .returns<QuickOrderProductRow[]>();

    const products = productRows ?? [];
    const overrides = await getProductPriceOverrides(
      supabase,
      products.map((product) => product.id),
      user.id,
      retailer?.area_id ?? null
    );

    cards = products
      .map((product) => {
        const packs: QuickOrderPack[] = product.product_packs
          .filter((pack) => pack.is_active)
          .map((pack) => ({
            id: pack.id,
            packName: pack.pack_name,
            unitsPerCase: pack.units_per_case,
            moq: pack.moq,
            mrp: pack.mrp,
            casePrice: resolvePackPrice(pack, overrides.get(product.id) ?? null),
          }));
        const images = [...product.product_images].sort((a, b) => a.sort_order - b.sort_order);
        return {
          id: product.id,
          name: product.name,
          brandName: product.brands?.name,
          imageUrl: images[0]?.image_url,
          gstPercent: product.gst_percent,
          packs,
        };
      })
      .filter((card) => card.packs.length > 0);
  }

  return (
    <div className="space-y-5 sm:space-y-6">
      <div className="flex items-center gap-1.5 text-[10px] font-semibold text-slate-500 sm:text-xs">
        <Link href="/retailer/home" className="hover:text-primary-600">Home</Link>
        <ChevronRight className="h-3 w-3" />
        <span className="text-slate-800">Quick Order</span>
      </div>

      <section className="marketplace-grid relative overflow-hidden rounded-2xl bg-gradient-to-r from-primary-800 via-primary-700 to-slate-950 p-5 text-white shadow-lg sm:p-8">
        <Zap className="absolute -bottom-8 -right-4 h-40 w-40 rotate-12 fill-white/5 text-white/5 sm:h-56 sm:w-56" />
        <div className="relative max-w-3xl">
          <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.2em] text-amber-300"><Sparkles className="h-3.5 w-3.5" /> Fast restocking</p>
          <h1 className="mt-2 text-2xl font-bold tracking-tight sm:text-4xl">Quick Order</h1>
          <p className="mt-2 max-w-xl text-xs leading-5 text-primary-100 sm:text-sm">Know what you need? Find products by name, choose a pack and add quantities without leaving this page.</p>

          <form method="get" className="relative mt-5 max-w-2xl">
            <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              name="q"
              defaultValue={q}
              placeholder="Try “rice”, “oil” or a brand name"
              autoFocus
              className="h-12 w-full rounded-xl border-0 bg-white pl-11 pr-24 text-sm text-slate-900 shadow-md outline-none placeholder:text-slate-400 focus:ring-2 focus:ring-amber-300"
            />
            <button type="submit" className="absolute right-1.5 top-1.5 h-9 rounded-lg bg-slate-950 px-5 text-xs font-bold text-white transition hover:bg-slate-800">Search</button>
          </form>
        </div>
      </section>

      <div className="grid grid-cols-3 gap-2 sm:gap-3">
        {[
          { icon: Barcode, title: 'Search by name', body: 'Find exact products fast' },
          { icon: PackageSearch, title: 'Choose pack', body: 'See price and MOQ' },
          { icon: ShoppingCart, title: 'Add instantly', body: 'Cart stays in sync' },
        ].map((item) => (
          <div key={item.title} className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm sm:flex sm:items-center sm:gap-3 sm:p-4">
            <item.icon className="h-5 w-5 text-primary-600" />
            <div><p className="mt-2 text-[10px] font-bold text-slate-800 sm:mt-0 sm:text-xs">{item.title}</p><p className="mt-0.5 hidden text-[10px] text-slate-500 sm:block">{item.body}</p></div>
          </div>
        ))}
      </div>

      {!q ? (
        <section className="grid overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm md:grid-cols-[1fr_0.9fr]">
          <div className="flex min-h-[250px] flex-col items-center justify-center p-7 text-center sm:items-start sm:text-left">
            <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary-50 text-primary-600"><Search className="h-6 w-6" /></span>
            <h2 className="mt-4 text-lg font-bold text-slate-900">Search to build your order</h2>
            <p className="mt-2 max-w-md text-xs leading-5 text-slate-500">Results include only active products and packs. Your current B2B price, GST and MOQ are shown before you add anything.</p>
            <Link href="/retailer/catalog" className="mt-4 flex items-center gap-1 text-xs font-bold text-primary-600">Or browse the full catalog <ArrowRight className="h-3.5 w-3.5" /></Link>
          </div>
          <div className="hidden bg-slate-950 p-7 text-white md:flex md:flex-col md:justify-center">
            <ShieldCheck className="h-7 w-7 text-emerald-400" />
            <h3 className="mt-4 text-lg font-bold">Same secure checkout</h3>
            <ul className="mt-4 space-y-3 text-xs text-slate-300">
              {['MOQ and availability revalidated', 'Retailer pricing applied securely', 'GST and credit checked before order'].map((item) => <li key={item} className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-emerald-400" /> {item}</li>)}
            </ul>
          </div>
        </section>
      ) : cards.length === 0 ? (
        <section className="rounded-2xl border border-slate-200 bg-white px-5 py-12 text-center shadow-sm">
          <PackageSearch className="mx-auto h-10 w-10 text-slate-300" />
          <h2 className="mt-3 text-base font-bold text-slate-800">No products found for “{q}”</h2>
          <p className="mt-1 text-xs text-slate-500">Check the spelling, try a shorter term, or browse all products.</p>
          <Link href="/retailer/catalog" className="mt-4 inline-flex h-9 items-center rounded-lg bg-primary-600 px-4 text-xs font-bold text-white">Browse catalog</Link>
        </section>
      ) : (
        <section className="space-y-3">
          <div className="flex items-end justify-between gap-3">
            <div><p className="text-[10px] font-bold uppercase tracking-[0.18em] text-primary-600">Search results</p><h2 className="mt-0.5 text-base font-bold text-slate-900 sm:text-xl">{cards.length} product{cards.length === 1 ? '' : 's'} found</h2></div>
            <Link href="/retailer/cart" className="flex h-9 items-center gap-1.5 rounded-lg border border-primary-200 bg-primary-50 px-3 text-[10px] font-bold text-primary-700"><ShoppingCart className="h-3.5 w-3.5" /> Review cart</Link>
          </div>

          <div className="hidden grid-cols-[72px_minmax(150px,1fr)_minmax(160px,0.8fr)_128px_minmax(140px,0.65fr)] gap-4 px-4 text-[9px] font-bold uppercase tracking-wider text-slate-400 sm:grid">
            <span>Product</span><span>Details</span><span>Pack size</span><span>Quantity</span><span className="text-right">Price & add</span>
          </div>
          <div className="space-y-2.5">{cards.map((card) => <QuickOrderRow key={card.id} {...card} />)}</div>
          {cards.length === MAX_RESULTS ? <p className="text-center text-[10px] text-slate-400">Showing the first {MAX_RESULTS} matches. Refine your search for a specific item.</p> : null}
        </section>
      )}
    </div>
  );
}
