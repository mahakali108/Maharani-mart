import Link from 'next/link';
import { Tag, ShieldCheck } from 'lucide-react';
import { requirePagePermission } from '@/lib/admin/guard';
import { createClient } from '@/lib/supabase/server';
import {
  OFFERS_PER_PAGE,
  listOfferFloors,
  listOffers,
  offerListHref,
  parseOfferListParams,
} from '@/lib/admin/sellers-query';
import { formatIndiaDateTime } from '@/lib/datetime/india';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { AdminEmptyState } from '@/components/admin/empty-state';
import { StatusBadge } from '@/components/admin/status-badge';
import { OfferRowActions } from '@/components/admin/offer-row-actions';
import { OfferFloorForm } from '@/components/admin/offer-forms';

export const dynamic = 'force-dynamic';

const inr = (paise: number) =>
  `₹${(paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * Seller offer moderation & price floors (/admin/offers).
 *
 * Authorization: `sellers.manage` server-side (requirePagePermission) on top
 * of admin/super_admin middleware. Price floors are append-only commercial
 * configuration (0063) — never derived from cost_price, never shown to sellers.
 */
export default async function AdminOffersPage({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  await requirePagePermission('sellers.manage');
  const query = parseOfferListParams(searchParams);
  const sellerId = typeof searchParams.seller === 'string' ? searchParams.seller : null;
  const { offers, total } = await listOffers({ ...query, sellerId });
  const pages = Math.max(1, Math.ceil(total / OFFERS_PER_PAGE));
  const currentPage = Math.min(query.page, pages);

  const supabase = createClient();
  const { data: joined } = await supabase
    .from('seller_offers' as never)
    .select('id, pack_id, seller_id');
  const offerMeta = new Map(
    ((joined ?? []) as unknown as { id: string; pack_id: string; seller_id: string }[]).map((row) => [
      row.id,
      row,
    ])
  );

  // Display-only joins (names come from the shared catalogue / sellers table).
  const { data: packRows } = await supabase
    .from('product_packs')
    .select('id, pack_name, products ( name )');
  const packNames = new Map(
    ((packRows ?? []) as unknown as {
      id: string;
      pack_name: string;
      products: { name: string } | null;
    }[]).map((row) => [row.id, `${row.products?.name ?? 'Product'} · ${row.pack_name}`])
  );
  const { data: sellerRows } = await supabase.from('sellers' as never).select('id, business_name');
  const sellerNames = new Map(
    ((sellerRows ?? []) as unknown as { id: string; business_name: string }[]).map((row) => [
      row.id,
      row.business_name,
    ])
  );

  const floorPacks = [...new Set(offers.map((offer) => offer.pack_id))];
  const floorRows = await Promise.all(floorPacks.map((packId) => listOfferFloors(packId)));
  const floorsByPack = new Map(floorPacks.map((packId, i) => [packId, floorRows[i] ?? []]));

  return (
    <div className="space-y-6">
      <header>
        <h1 className="flex items-center gap-2 text-2xl font-semibold text-ink-900">
          <Tag className="h-6 w-6 text-primary-600" aria-hidden /> Seller offers
        </h1>
        <p className="mt-1 text-sm text-ink-500">
          Moderate marketplace offers and set the admin minimum price per pack. Offers are
          deactivated, never deleted — order history keeps its snapshots.
        </p>
      </header>

      <form className="flex flex-wrap items-end gap-3" method="get">
        <Input name="q" placeholder="Search seller SKU…" defaultValue={query.q} className="max-w-xs" />
        <Select name="moderation" defaultValue={query.moderation} className="max-w-[12rem]">
          <option value="all">All moderation</option>
          <option value="pending">Pending</option>
          <option value="approved">Approved</option>
          <option value="rejected">Rejected</option>
        </Select>
        <Button type="submit" variant="outline" size="sm">
          Filter
        </Button>
        {(query.q || query.moderation !== 'all' || sellerId) && (
          <Link href="/admin/offers" className="text-sm text-ink-500 hover:underline">
            Clear
          </Link>
        )}
      </form>

      {offers.length === 0 ? (
        <AdminEmptyState
          icon={ShieldCheck}
          title="No offers to review"
          body="Offers created for sellers appear here for moderation and floor management."
        />
      ) : (
        <div className="space-y-4">
          {offers.map((offer) => {
            const meta = offerMeta.get(offer.id);
            const packName = meta ? packNames.get(meta.pack_id) ?? 'Unknown pack' : 'Unknown pack';
            const sellerName = meta ? sellerNames.get(meta.seller_id) ?? 'Unknown seller' : 'Unknown seller';
            const floors = meta ? floorsByPack.get(meta.pack_id) ?? [] : [];
            return (
              <Card key={offer.id} className="p-5">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <p className="text-sm font-semibold text-ink-900">
                      {inr(offer.unit_price_paise)} / piece
                      <span className="ml-2 text-xs font-normal text-ink-500">
                        MOQ {offer.moq} ·{' '}
                        {offer.fulfilment_type === 'seller' ? 'Seller-fulfilled' : 'Maharani-fulfilled'}
                        {offer.stock_quantity !== null ? ` · stock ${offer.stock_quantity}` : ''}
                      </span>
                    </p>
                    <p className="mt-1 text-xs text-ink-500">
                      <Link href={`/admin/sellers/${offer.seller_id}`} className="hover:underline">
                        {sellerName}
                      </Link>{' '}
                      · {packName} · created {formatIndiaDateTime(offer.created_at)}
                    </p>
                    <p className="mt-2 flex flex-wrap items-center gap-2">
                      <StatusBadge status={offer.moderation_status} />
                      <StatusBadge status={offer.is_active ? 'active' : 'inactive'} />
                    </p>
                  </div>
                  <OfferRowActions
                    offerId={offer.id}
                    moderationStatus={offer.moderation_status}
                    isActive={offer.is_active}
                  />
                </div>

                <details className="mt-4">
                  <summary className="cursor-pointer text-xs text-ink-500">
                    Price floors for this pack (append-only history)
                  </summary>
                  <div className="mt-3 space-y-3">
                    {floors.length > 0 ? (
                      <ul className="space-y-1 text-xs text-ink-600">
                        {floors.map((floor) => (
                          <li key={floor.id}>
                            <strong>{inr(floor.floor_paise)}</strong> from{' '}
                            {formatIndiaDateTime(floor.effective_from)}
                            {floor.note ? ` — ${floor.note}` : ''}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-xs text-ink-500">No floor configured — any positive price is allowed.</p>
                    )}
                    {meta ? <OfferFloorForm packId={meta.pack_id} /> : null}
                  </div>
                </details>
              </Card>
            );
          })}
        </div>
      )}

      {pages > 1 ? (
        <nav className="flex items-center gap-2 text-sm" aria-label="Pagination">
          {Array.from({ length: pages }, (_, i) => i + 1).map((page) => (
            <Link
              key={page}
              href={offerListHref({ ...query, sellerId }, page)}
              className={
                page === currentPage
                  ? 'rounded-lg bg-primary-600 px-3 py-1 text-white'
                  : 'rounded-lg border border-ink/10 px-3 py-1 text-ink-600'
              }
            >
              {page}
            </Link>
          ))}
        </nav>
      ) : null}
    </div>
  );
}
