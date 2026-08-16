import Link from 'next/link';
import Image from 'next/image';
import { ArrowRight, ClipboardList, LayoutGrid, RotateCcw, Zap, Heart, Tag, Truck } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { requireUser } from '@/lib/auth/session';
import { getProductPriceOverride, resolvePackPrice } from '@/lib/retailer/effective-price';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { CreditSummary } from '@/components/retailer/credit-summary';
import { FrequentProductCard } from '@/components/retailer/frequent-product-card';

interface BannerRow {
  id: string;
  title: string;
  image_url: string;
  link_url: string | null;
}

interface OrderRow {
  id: string;
  order_number: string;
  status: string;
  grand_total: number;
  placed_at: string;
}

interface RetailerRow {
  shop_name: string;
  area_id: string;
  credit_limit: number;
  outstanding_balance: number;
}

interface SchemeRow {
  id: string;
  name: string;
  description: string | null;
  is_festival: boolean;
  ends_at: string;
}

interface FavoriteRow {
  product_id: string;
  products: { id: string; name: string; is_active: boolean } | null;
}

interface FrequentItemRow {
  product_id: string;
  quantity: number;
  order_id: string;
  products: {
    id: string;
    name: string;
    is_active: boolean;
    product_images: { image_url: string; sort_order: number }[];
    product_packs: { id: string; pack_name: string; base_price: number; ptr: number | null; moq: number; is_active: boolean; sort_order: number }[];
  } | null;
}

const OPEN_ORDER_STATUSES = ['pending', 'confirmed', 'processing', 'packed', 'dispatched'];

const ORDER_STATUS_STYLES: Record<string, string> = {
  pending: 'bg-amber-50 text-amber-700',
  confirmed: 'bg-blue-50 text-blue-700',
  processing: 'bg-blue-50 text-blue-700',
  packed: 'bg-violet-50 text-violet-700',
  dispatched: 'bg-violet-50 text-violet-700',
  delivered: 'bg-green-50 text-green-700',
  cancelled: 'bg-primary-50 text-primary-700',
  returned: 'bg-primary-50 text-primary-700',
};

function OrderListRow({ order }: { order: OrderRow }) {
  return (
    <Link key={order.id} href={`/retailer/orders/${order.id}`}>
      <div className="flex items-center justify-between py-2.5">
        <div className="min-w-0">
          <p className="truncate font-mono text-sm font-medium text-ink-900">{order.order_number}</p>
          <p className="text-xs text-ink-400">
            {new Date(order.placed_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <p className="text-sm font-semibold text-ink-900">₹{order.grand_total.toFixed(2)}</p>
          <span
            className={`rounded-full px-2 py-0.5 text-xs font-medium ${ORDER_STATUS_STYLES[order.status] ?? 'bg-ink-100 text-ink-600'}`}
          >
            {order.status.charAt(0).toUpperCase() + order.status.slice(1)}
          </span>
        </div>
      </div>
    </Link>
  );
}

/**
 * Retailer dashboard (Requirement A). Every query below is keyed to
 * the session user id (and doubly enforced by RLS — orders_select,
 * cart_owner, retailer_favorites_owner_read, schemes_read), so the
 * page can never surface another retailer's data even if a link or
 * id is guessed.
 */
export default async function RetailerHomePage() {
  const user = await requireUser();
  const supabase = createClient();

  const { data: retailer } = await supabase
    .from('retailers')
    .select('shop_name, area_id, credit_limit, outstanding_balance')
    .eq('id', user.id)
    .maybeSingle<RetailerRow>();

  const nowIso = new Date().toISOString();

  const [
    { data: bannerRows },
    { data: openOrders },
    { data: recentOrders },
    { data: lastDelivered },
    { data: schemeData },
    { data: favoriteData },
  ] = await Promise.all([
    // banners_read RLS already limits this to is_active rows for
    // non-staff roles; filters below just pick the ones relevant now.
    supabase
      .from('banners')
      .select('id, title, image_url, link_url, area_id, starts_at, ends_at')
      .eq('is_active', true)
      .order('sort_order'),
    supabase
      .from('orders')
      .select('id, order_number, status, grand_total, placed_at')
      .eq('retailer_id', user.id)
      .in('status', OPEN_ORDER_STATUSES)
      .order('placed_at', { ascending: false })
      .limit(5)
      .returns<OrderRow[]>(),
    supabase
      .from('orders')
      .select('id, order_number, status, grand_total, placed_at')
      .eq('retailer_id', user.id)
      .order('placed_at', { ascending: false })
      .limit(5)
      .returns<OrderRow[]>(),
    supabase
      .from('orders')
      .select('id, order_number, status, grand_total, placed_at')
      .eq('retailer_id', user.id)
      .eq('status', 'delivered')
      .order('placed_at', { ascending: false })
      .limit(1)
      .returns<OrderRow[]>(),
    // schemes_read RLS already restricts retailers to is_active rows.
    supabase
      .from('schemes')
      .select('id, name, description, is_festival, ends_at')
      .eq('is_active', true)
      .lte('starts_at', nowIso)
      .gte('ends_at', nowIso)
      .order('ends_at')
      .limit(5)
      .returns<SchemeRow[]>(),
    supabase
      .from('retailer_favorites')
      .select('product_id, products ( id, name, is_active )')
      .eq('retailer_id', user.id)
      .order('created_at', { ascending: false })
      .limit(8)
      .returns<FavoriteRow[]>(),
  ]);

  const banners = ((bannerRows ?? []) as unknown as (BannerRow & {
    area_id: string | null;
    starts_at: string | null;
    ends_at: string | null;
  })[]).filter((b) => {
    const areaMatches = !b.area_id || b.area_id === retailer?.area_id;
    const started = !b.starts_at || b.starts_at <= nowIso;
    const notEnded = !b.ends_at || b.ends_at >= nowIso;
    return areaMatches && started && notEnded;
  });

  const schemes = schemeData ?? [];
  const favorites = (favoriteData ?? []).filter((f) => f.products?.is_active);
  const open = openOrders ?? [];
  const recent = recentOrders ?? [];
  const reorderTarget = lastDelivered?.[0] ?? null;

  // Frequently ordered products (Requirement A/10): aggregate this
  // retailer's own recent order lines — no new tables, computed
  // read-only from order_items joined through their own orders.
  const { data: freqOrderIds } = await supabase
    .from('orders')
    .select('id')
    .eq('retailer_id', user.id)
    .neq('status', 'cancelled')
    .order('placed_at', { ascending: false })
    .limit(25)
    .returns<{ id: string }[]>();
  const recentOrderIds = (freqOrderIds ?? []).map((o) => o.id);
  let frequentCards: {
    id: string;
    name: string;
    imageUrl?: string;
    packId: string | null;
    packName?: string;
    moq: number;
    effectivePrice: number | null;
    timesOrdered: number;
  }[] = [];

  if (recentOrderIds.length > 0) {
    const { data: freqRows } = await supabase
      .from('order_items')
      .select(
        'product_id, quantity, order_id, products ( id, name, is_active, product_images ( image_url, sort_order ), product_packs ( id, pack_name, base_price, ptr, moq, is_active, sort_order ) )'
      )
      .in('order_id', recentOrderIds)
      .limit(500)
      .returns<FrequentItemRow[]>();

    const byProduct = new Map<string, { times: number; qty: number; product: NonNullable<FrequentItemRow['products']> }>();
    for (const row of freqRows ?? []) {
      if (!row.products?.is_active) continue;
      const entry = byProduct.get(row.product_id) ?? { times: 0, qty: 0, product: row.products };
      entry.times += 1;
      entry.qty += row.quantity;
      byProduct.set(row.product_id, entry);
    }

    const top = [...byProduct.entries()]
      .sort((a, b) => b[1].times - a[1].times || b[1].qty - a[1].qty)
      .slice(0, 6);

    const overrides = await Promise.all(
      top.map(([productId]) => getProductPriceOverride(supabase, productId, user.id, retailer?.area_id ?? null))
    );

    frequentCards = top.map(([productId, info], i) => {
      const packs = [...info.product.product_packs]
        .filter((p) => p.is_active)
        .sort((a, b) => a.sort_order - b.sort_order);
      const pack = packs[0] ?? null;
      const sortedImages = [...info.product.product_images].sort((a, b) => a.sort_order - b.sort_order);
      return {
        id: productId,
        name: info.product.name,
        imageUrl: sortedImages[0]?.image_url,
        packId: pack?.id ?? null,
        packName: pack?.pack_name,
        moq: pack?.moq ?? 1,
        effectivePrice: pack ? resolvePackPrice(pack, overrides[i] ?? null) : null,
        timesOrdered: info.times,
      };
    });
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-ink-950">{retailer?.shop_name ?? 'Welcome'}</h1>
        <p className="mt-1 text-sm text-ink-500">Your orders, credit and offers at a glance.</p>
      </div>

      {banners.length > 0 ? (
        <div className="-mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0">
          {banners.map((b) =>
            b.link_url ? (
              <a
                key={b.id}
                href={b.link_url}
                target="_blank"
                rel="noreferrer"
                className="relative aspect-[2/1] w-full max-w-sm shrink-0 snap-start overflow-hidden rounded-2xl border border-ink-100"
              >
                <Image src={b.image_url} alt={b.title} fill className="object-cover" unoptimized />
              </a>
            ) : (
              <div
                key={b.id}
                className="relative aspect-[2/1] w-full max-w-sm shrink-0 snap-start overflow-hidden rounded-2xl border border-ink-100"
              >
                <Image src={b.image_url} alt={b.title} fill className="object-cover" unoptimized />
              </div>
            )
          )}
        </div>
      ) : null}

      {/* Shortcuts */}
      <div className="grid grid-cols-2 gap-3">
        <Link href="/retailer/quick-order">
          <Card className="flex h-full items-center gap-3 p-4 transition-shadow hover:shadow-premium">
            <Zap className="h-5 w-5 shrink-0 text-primary-600" />
            <div>
              <p className="text-sm font-medium text-ink-900">Quick order</p>
              <p className="text-xs text-ink-400">Search SKU &amp; add</p>
            </div>
          </Card>
        </Link>
        <Link href="/retailer/catalog">
          <Card className="flex h-full items-center gap-3 p-4 transition-shadow hover:shadow-premium">
            <LayoutGrid className="h-5 w-5 shrink-0 text-primary-600" />
            <div>
              <p className="text-sm font-medium text-ink-900">Catalog</p>
              <p className="text-xs text-ink-400">Browse all products</p>
            </div>
          </Card>
        </Link>
      </div>

      {retailer ? (
        <CreditSummary creditLimit={retailer.credit_limit} outstandingBalance={retailer.outstanding_balance} />
      ) : null}

      {reorderTarget ? (
        <Card className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 text-sm font-medium text-ink-900">
              <RotateCcw className="h-4 w-4 text-primary-600" />
              Quick reorder
            </p>
            <p className="mt-0.5 truncate text-xs text-ink-400">
              Repeat <span className="font-mono">{reorderTarget.order_number}</span> — edit quantities,
              current prices apply
            </p>
          </div>
          <Link href={`/retailer/orders/${reorderTarget.id}/reorder`} className="shrink-0">
            <span className="inline-flex items-center gap-1 rounded-xl bg-primary-600 px-3.5 py-2 text-sm font-medium text-white hover:bg-primary-700">
              Reorder
              <ArrowRight className="h-4 w-4" />
            </span>
          </Link>
        </Card>
      ) : null}

      {open.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-1.5">
              <Truck className="h-4 w-4 text-violet-600" />
              Orders on the way ({open.length})
            </CardTitle>
          </CardHeader>
          <div className="divide-y divide-ink-50">
            {open.map((order) => (
              <OrderListRow key={order.id} order={order} />
            ))}
          </div>
        </Card>
      ) : null}

      {frequentCards.length > 0 ? (
        <div className="space-y-2">
          <h2 className="text-sm font-semibold text-ink-900">Frequently ordered</h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {frequentCards.map((card) => (
              <FrequentProductCard key={card.id} {...card} />
            ))}
          </div>
        </div>
      ) : null}

      {favorites.length > 0 ? (
        <div className="space-y-2">
          <h2 className="flex items-center gap-1.5 text-sm font-semibold text-ink-900">
            <Heart className="h-4 w-4 text-primary-600" />
            Favourites
          </h2>
          <div className="flex flex-wrap gap-2">
            {favorites.map((f) => (
              <Link key={f.product_id} href={`/retailer/catalog/${f.product_id}`}>
                <span className="inline-block rounded-full border border-ink-200 bg-white px-3.5 py-1.5 text-sm text-ink-700">
                  {f.products?.name}
                </span>
              </Link>
            ))}
          </div>
        </div>
      ) : null}

      {schemes.length > 0 ? (
        <div className="space-y-2">
          <h2 className="flex items-center gap-1.5 text-sm font-semibold text-ink-900">
            <Tag className="h-4 w-4 text-primary-600" />
            Active offers &amp; schemes
          </h2>
          <div className="space-y-2">
            {schemes.map((scheme) => (
              <Card key={scheme.id} className="space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-medium text-ink-900">{scheme.name}</p>
                  {scheme.is_festival ? (
                    <span className="rounded-full bg-primary-50 px-2 py-0.5 text-[10px] font-semibold uppercase text-primary-600">
                      Festival
                    </span>
                  ) : null}
                </div>
                {scheme.description ? <p className="text-xs text-ink-500">{scheme.description}</p> : null}
                <p className="text-xs text-ink-400">
                  Valid till{' '}
                  {new Date(scheme.ends_at).toLocaleDateString('en-IN', {
                    day: 'numeric',
                    month: 'short',
                    year: 'numeric',
                  })}
                </p>
              </Card>
            ))}
          </div>
        </div>
      ) : null}

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-1.5">
              <ClipboardList className="h-4 w-4 text-primary-600" />
              Recent orders
            </CardTitle>
            <Link href="/retailer/orders" className="text-xs font-medium text-primary-600 hover:text-primary-700">
              View all
            </Link>
          </div>
        </CardHeader>
        {recent.length === 0 ? (
          <div className="py-4 text-center">
            <p className="text-sm text-ink-500">No orders yet. Start with the catalog or a quick order.</p>
          </div>
        ) : (
          <div className="divide-y divide-ink-50">
            {recent.map((order) => (
              <OrderListRow key={order.id} order={order} />
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
