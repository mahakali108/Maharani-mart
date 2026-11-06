import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, Tag, UserRound } from 'lucide-react';
import { requirePagePermission } from '@/lib/admin/guard';
import { createClient } from '@/lib/supabase/server';
import { getSellerDetail } from '@/lib/admin/sellers-query';
import { formatIndiaDateTime } from '@/lib/datetime/india';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/admin/status-badge';
import { SellerInvitePanel } from '@/components/admin/seller-invite-panel';
import { SellerReviewActions } from '@/components/admin/seller-review-actions';
import { OfferRowActions } from '@/components/admin/offer-row-actions';
import { EditOfferForm, CreateOfferForm, type PackOption } from '@/components/admin/offer-forms';

export const dynamic = 'force-dynamic';

const inr = (paise: number) =>
  `₹${(paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * Seller review detail (/admin/sellers/[id]): identity, review controls,
 * membership and the seller's offers with moderation actions. All data is
 * RLS-scoped and restricted to Super Admin. Sellers use the separate
 * tenant-guarded portal; they cannot access this admin page.
 */
export default async function SellerDetailPage({
  params: paramsPromise,
}: {
  params: Promise<{ id: string }>;
}) {
  const params = await paramsPromise;
  await requirePagePermission('sellers.view');
  const { seller, members, offers, invite, failureMessage } = await getSellerDetail(params.id);
  // A failed read is not a missing seller: 404 would tell the operator the
  // seller account was deleted.
  if (failureMessage) throw new Error(`Seller could not be loaded: ${failureMessage}`);
  if (!seller) notFound();

  // Active packs for the admin-managed offer form (server-fetched; the pack
  // owns its product identity and the server re-reads it on submit).
  const supabase = (await createClient());
  const { data: packRows } = await supabase
    .from('product_packs')
    .select('id, product_id, pack_name, is_active, products ( name, is_active )')
    .eq('is_active', true)
    .order('sort_order', { ascending: true })
    .limit(500);
  const packs: PackOption[] = ((packRows ?? []) as unknown as {
    id: string;
    product_id: string;
    pack_name: string;
    products: { name: string; is_active: boolean } | null;
  }[])
    .filter((row) => row.products?.is_active)
    .map((row) => ({
      packId: row.id,
      productId: row.product_id,
      label: `${row.products?.name ?? 'Product'} · ${row.pack_name}`,
    }));

  return (
    <div className="space-y-6">
      <header>
        <Link
          href="/admin/sellers"
          className="inline-flex items-center gap-1 text-sm text-ink-500 hover:underline"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden /> All sellers
        </Link>
        <h1 className="mt-2 flex flex-wrap items-center gap-3 text-2xl font-semibold text-ink-900">
          {seller.business_name}
          <StatusBadge status={seller.status} />
        </h1>
        <p className="mt-1 text-sm text-ink-500">
          Created {formatIndiaDateTime(seller.created_at)}
          {seller.reviewed_at ? ` · last review ${formatIndiaDateTime(seller.reviewed_at)}` : ''}
        </p>
      </header>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="p-5">
          <h2 className="text-sm font-semibold text-ink-800">Business details</h2>
          <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            <div>
              <dt className="text-xs text-ink-500">Contact</dt>
              <dd className="text-ink-900">{seller.contact_name || '—'}</dd>
            </div>
            <div>
              <dt className="text-xs text-ink-500">Phone</dt>
              <dd className="text-ink-900">{seller.phone || '—'}</dd>
            </div>
            <div>
              <dt className="text-xs text-ink-500">Email</dt>
              <dd className="text-ink-900">{seller.email || '—'}</dd>
            </div>
            <div>
              <dt className="text-xs text-ink-500">GSTIN / PAN</dt>
              <dd className="text-ink-900">{seller.gstin || '—'} / {seller.pan || '—'}</dd>
            </div>
            <div className="col-span-2">
              <dt className="text-xs text-ink-500">Address</dt>
              <dd className="text-ink-900">{seller.address_line || '—'}</dd>
            </div>
            {seller.rejection_reason ? (
              <div className="col-span-2">
                <dt className="text-xs text-ink-500">Rejection reason</dt>
                <dd className="text-ink-900">{seller.rejection_reason}</dd>
              </div>
            ) : null}
            {seller.suspension_reason ? (
              <div className="col-span-2">
                <dt className="text-xs text-ink-500">Suspension reason</dt>
                <dd className="text-ink-900">{seller.suspension_reason}</dd>
              </div>
            ) : null}
          </dl>
        </Card>

        <Card className="p-5">
          <h2 className="text-sm font-semibold text-ink-800">Account invitation &amp; review</h2>
          <SellerInvitePanel sellerId={seller.id} sellerStatus={seller.status} invite={invite} hasMember={members.length > 0} />
          <p className="my-3 text-xs leading-5 text-ink-600">Confirm the business name, contact, tax identity (if provided) and email ownership against your own verification documents before approving. Submitted identifiers are not independently verified by this site.</p>
          <div className="mt-3">
            {seller.status === 'pending' || seller.status === 'active' || seller.status === 'suspended' ? (
              <SellerReviewActions
                sellerId={seller.id}
                canApprove={members.length > 0}
                status={seller.status as 'pending' | 'active' | 'suspended'}
              />
            ) : (
              <p className="text-sm text-ink-600">
                This application was rejected. Create a new seller record to reconsider.
              </p>
            )}
          </div>

          <h2 className="mt-6 flex items-center gap-2 text-sm font-semibold text-ink-800">
            <UserRound className="h-4 w-4" aria-hidden /> Members
          </h2>
          {members.length === 0 ? (
            <p className="mt-2 text-sm text-ink-500">
              No seller login is linked. Only Super Admin can invite and link an account. Do not approve until the invitation has created a member.
            </p>
          ) : (
            <ul className="mt-2 space-y-1 text-sm text-ink-700">
              {members.map((member) => (
                <li key={member.id}>
                  <code className="text-xs">{member.profile_id}</code> · {member.member_role}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card className="p-5">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-ink-800">
          <Tag className="h-4 w-4" aria-hidden /> Add an offer
        </h2>
        <p className="mb-3 mt-1 text-xs text-ink-500">
          Offers reference existing catalogue packs (no duplicate products). Prices must clear the
          admin floor; new offers start in pending moderation.
        </p>
        <CreateOfferForm sellerId={seller.id} packs={packs} />
      </Card>

      <section className="space-y-4">
        <h2 className="text-sm font-semibold text-ink-800">Offers ({offers.length})</h2>
        {offers.length === 0 ? (
          <p className="text-sm text-ink-500">This seller has no offers yet.</p>
        ) : (
          offers.map((offer) => (
            <Card key={offer.id} className="p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-ink-900">
                    {inr(offer.unit_price_paise)} / piece
                    <span className="ml-2 text-xs font-normal text-ink-500">
                      MOQ {offer.moq} · {offer.fulfilment_type === 'seller' ? 'Seller-fulfilled' : 'Maharani-fulfilled'}
                      {offer.stock_quantity !== null ? ` · stock ${offer.stock_quantity}` : ''}
                    </span>
                  </p>
                  <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-ink-500">
                    <StatusBadge status={offer.moderation_status} />
                    <StatusBadge status={offer.is_active ? 'active' : 'inactive'} />
                    pack <code>{offer.pack_id}</code>
                    {offer.seller_sku ? ` · SKU ${offer.seller_sku}` : ''}
                  </p>
                </div>
                <OfferRowActions
                  offerId={offer.id}
                  moderationStatus={offer.moderation_status}
                  isActive={offer.is_active}
                />
              </div>
              <details className="mt-4">
                <summary className="cursor-pointer text-xs text-ink-500">Edit trading fields</summary>
                <div className="mt-3">
                  <EditOfferForm offer={offer} />
                </div>
              </details>
            </Card>
          ))
        )}
      </section>

      <div>
        <Link href="/admin/offers">
          <Button variant="outline" size="sm">
            Manage all offers & price floors
          </Button>
        </Link>
      </div>
    </div>
  );
}
