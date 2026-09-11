import Link from 'next/link';
import { ChevronLeft, ChevronRight, ShoppingBasket } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { requireUser } from '@/lib/auth/session';
import { SavedCartList, type SavedCartView } from '@/components/retailer/saved-cart-list';

interface SavedCartRow {
  id: string;
  name: string;
  updated_at: string;
}

interface SavedCartItemRow {
  id: string;
  saved_cart_id: string;
  quantity: number;
  products: {
    name: string;
    brands: { name: string } | null;
    product_images: { image_url: string; sort_order: number }[];
  } | null;
  product_packs: { pack_name: string } | null;
}

export const metadata = { title: 'Saved carts — Maharani Traders' };

export default async function SavedCartsPage() {
  const user = await requireUser();
  const supabase = createClient();

  const [{ data: cartRows }, { data: itemRows }] = await Promise.all([
    supabase
      .from('retailer_saved_carts')
      .select('id, name, updated_at')
      .eq('retailer_id', user.id)
      .order('updated_at', { ascending: false }),
    supabase
      .from('retailer_saved_cart_items')
      .select('id, pack_id, quantity, products ( name, brands ( name ), product_images ( image_url, sort_order ) ), product_packs ( pack_name )')
      .eq('retailer_id', user.id),
  ]);

  const carts = ((cartRows ?? []) as unknown as SavedCartRow[]).filter((row) => row.id);
  const items = ((itemRows ?? []) as unknown as SavedCartItemRow[]).filter((row) => row.id);

  const itemsByCart = new Map<string, SavedCartView['items']>();
  for (const item of items) {
    const list = itemsByCart.get(item.saved_cart_id) ?? [];
    list.push({
      id: item.id,
      quantity: item.quantity,
      productName: item.products?.name ?? 'Unavailable product',
      packName: item.product_packs?.pack_name ?? '',
      brandName: item.products?.brands?.name ?? null,
      imageUrl: null,
    });
    itemsByCart.set(item.saved_cart_id, list);
  }

  const views: SavedCartView[] = carts.map((cart) => ({
    id: cart.id,
    name: cart.name,
    updatedAt: cart.updated_at,
    items: itemsByCart.get(cart.id) ?? [],
  }));

  return (
    <div className="mx-auto w-full max-w-2xl space-y-5">
      <nav aria-label="Breadcrumb" className="flex items-center gap-1 text-[10px] font-semibold text-slate-500 sm:text-xs">
        <Link href="/retailer/cart" className="flex items-center gap-1 rounded px-1 py-0.5 hover:text-primary-600">
          <ChevronLeft className="h-3.5 w-3.5" /> Cart
        </Link>
        <ChevronRight className="h-3 w-3" />
        <span className="truncate text-slate-800">Saved carts</span>
      </nav>

      <div>
        <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-primary-600">Your lists</p>
        <h1 className="mt-1 text-xl font-bold tracking-tight text-slate-950 sm:text-2xl">Saved carts</h1>
        <p className="mt-1 text-xs text-slate-500">
          Keep your regular order lists ready — restore one into the cart whenever you want to order it.
        </p>
      </div>

      {views.length === 0 ? (
        <section className="flex min-h-[260px] flex-col items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-white px-4 py-8 text-center">
          <ShoppingBasket className="h-8 w-8 text-slate-300" aria-hidden="true" />
          <h2 className="mt-3 text-sm font-bold text-slate-800">No saved carts yet</h2>
          <p className="mt-1 max-w-xs text-[11px] leading-4 text-slate-500">
            Add products to your cart, then tap “Save cart” to keep the list here for next time.
          </p>
          <Link href="/retailer/catalog" className="mt-4 text-xs font-bold text-primary-600">
            Browse products
          </Link>
        </section>
      ) : (
        <SavedCartList carts={views} />
      )}
    </div>
  );
}
