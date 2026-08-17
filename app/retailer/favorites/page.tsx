import Link from 'next/link';
import { ChevronRight, Heart } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { requireUser } from '@/lib/auth/session';
import { ProductCard } from '@/components/retailer/product-card';
import { loadFavoriteIds, loadProductsByIds, priceCatalogProducts } from '@/lib/retailer/catalog';

export default async function FavoritesPage() {
  const user = await requireUser();
  const supabase = createClient();
  const [{ data: retailer }, favoriteIds] = await Promise.all([
    supabase.from('retailers').select('area_id').eq('id', user.id).maybeSingle<{ area_id: string }>(),
    loadFavoriteIds(supabase, user.id),
  ]);
  const products = await loadProductsByIds(supabase, [...favoriteIds]);
  const cards = await priceCatalogProducts(supabase, products, user.id, retailer?.area_id ?? null, favoriteIds);

  return (
    <div className="space-y-5 sm:space-y-6">
      <div className="flex items-center gap-1.5 text-[10px] font-semibold text-slate-500 sm:text-xs">
        <Link href="/retailer/home" className="hover:text-primary-600">Home</Link>
        <ChevronRight className="h-3 w-3" />
        <span className="text-slate-800">Favourites</span>
      </div>
      <div>
        <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-primary-600">Saved for later</p>
        <h1 className="mt-1 text-xl font-bold tracking-tight text-slate-950 sm:text-3xl">Your favourites</h1>
        <p className="mt-1 text-xs text-slate-500">{cards.length} saved product{cards.length === 1 ? '' : 's'}</p>
      </div>

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
