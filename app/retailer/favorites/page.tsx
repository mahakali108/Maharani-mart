import Link from 'next/link';
import { BellPlus, ChevronRight, Heart } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { requireUser } from '@/lib/auth/session';
import { ProductCard } from '@/components/retailer/product-card';
import { loadFavoriteIds, loadProductsByIds, priceCatalogProducts } from '@/lib/retailer/catalog';
import { StockAlertButton } from '@/components/retailer/product-feedback';
import { BRAND } from '@/lib/brand';

export const metadata = { title: `Favourites — ${BRAND.name}` };

export default async function FavoritesPage() {
  const user = await requireUser();
  const supabase = (await createClient());
  const [{ data: retailer }, favoriteIds] = await Promise.all([
    supabase.from('retailers').select('area_id').eq('id', user.id).maybeSingle<{ area_id: string }>(),
    loadFavoriteIds(supabase, user.id),
  ]);
  const products = await loadProductsByIds(supabase, [...favoriteIds]);
  const cards = await priceCatalogProducts(supabase, products, user.id, retailer?.area_id ?? null, favoriteIds);

  // Availability belongs to the exact default pack shown on each card.
  const { data: alertRows } = await supabase
    .from('retailer_stock_alerts')
    .select('pack_id')
    .eq('retailer_id', user.id);
  const subscribedPackIds = new Set(((alertRows ?? []) as { pack_id: string }[]).map((row) => row.pack_id));
  const outOfStockFavorites = cards.filter((card) => card.availability === 'out_of_stock');

  return (
    <div className="space-y-5 sm:space-y-6">
      <div className="flex items-center gap-1.5 text-[10px] font-semibold text-slate-500 sm:text-xs">
        <Link href="/retailer/home" className="hover:text-primary-600">Home</Link>
        <ChevronRight className="h-3 w-3" />
        <span className="text-slate-800">Favourites</span>
      </div>
      <div className="shop-intro">
          <p className="shop-eyebrow">Saved for later</p>
        <h1 className="shop-heading mt-1 font-semibold tracking-tight text-slate-950">Your favourites</h1>
        <p className="mt-1 text-xs text-slate-500">{cards.length} saved product{cards.length === 1 ? '' : 's'}</p>
      </div>

      {/* Wishlist availability alerts — real stock status, opt-in notify. */}
      {outOfStockFavorites.length > 0 ? (
        <section
          aria-label="Out of stock favourites"
          className="rounded-2xl border border-amber-200 bg-amber-50/70 p-4"
        >
          <h2 className="flex items-center gap-1.5 text-xs font-bold text-amber-900">
            <BellPlus className="h-4 w-4" aria-hidden="true" />
            {outOfStockFavorites.length} saved product{outOfStockFavorites.length === 1 ? ' is' : 's are'} currently out of stock
          </h2>
          <ul className="mt-3 space-y-2.5">
            {outOfStockFavorites.map((card) => {
              const alertPackId = card.defaultPackId;
              return (
                <li key={card.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-white p-3">
                  <Link href={`/retailer/catalog/${card.id}`} className="min-w-0 flex-1 text-[11px] font-bold text-slate-900 hover:text-primary-600">
                    <span className="block truncate">{card.name}</span>
                    <span className="mt-0.5 block text-[10px] font-semibold text-amber-700">Out of stock</span>
                  </Link>
                  {alertPackId ? subscribedPackIds.has(alertPackId) ? (
                    <span className="shrink-0 rounded-xl border-2 border-mint-500 bg-mint-50 px-3 py-2 text-[10px] font-bold text-mint-700">
                      Notify on
                    </span>
                  ) : (
                    <StockAlertButton packId={alertPackId} subscribed={false} />
                  ) : null}
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      {cards.length === 0 ? (
        <section className="flex min-h-[320px] flex-col items-center justify-center rounded-2xl border border-slate-200 bg-white text-center shadow-sm">
          <Heart className="h-8 w-8 text-slate-300" />
          <h2 className="mt-3 text-sm font-bold text-slate-800">No favourites yet</h2>
          <p className="mt-1 max-w-sm text-xs text-slate-500">Tap the heart on any product to save it here for faster reordering.</p>
          <Link href="/retailer/catalog" className="mt-4 text-xs font-bold text-primary-600">Browse products</Link>
        </section>
      ) : (
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4 xl:grid-cols-5">
          {cards.map((card) => (
            <ProductCard key={card.id} {...card} />
          ))}
        </div>
      )}
    </div>
  );
}
