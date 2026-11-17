import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, BarChart3, FileCheck2, History, SlidersHorizontal, Tag, UserRound } from 'lucide-react';
import { requirePagePermission } from '@/lib/admin/guard';
import { createClient } from '@/lib/supabase/server';
import { getSellerDetail, getSellerGovernanceOverview } from '@/lib/admin/sellers-query';
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
  const [{ seller, members, offers, invite, failureMessage }, governance] = await Promise.all([
    getSellerDetail(params.id),
    getSellerGovernanceOverview(params.id),
  ]);
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

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="p-5">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-ink-800">
            <FileCheck2 className="h-4 w-4" aria-hidden /> Compliance &amp; verification documents
          </h2>
          {governance.compliance ? (
            <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
              <div>
                <dt className="text-ink-500">Review status</dt>
                <dd className="mt-0.5"><StatusBadge status={governance.compliance.review_status} /></dd>
              </div>
              <div>
                <dt className="text-ink-500">Seller agreement</dt>
                <dd className="text-ink-900">
                  {governance.compliance.seller_agreement_version
                    ? `v${governance.compliance.seller_agreement_version}`
                    : 'Not accepted'}
                </dd>
              </div>
              <div>
                <dt className="text-ink-500">Identity / Address / Contact</dt>
                <dd className="text-ink-900">
                  {governance.compliance.business_identity_verified ? 'Yes' : 'No'} /{' '}
                  {governance.compliance.business_address_verified ? 'Yes' : 'No'} /{' '}
                  {governance.compliance.business_contact_verified ? 'Yes' : 'No'}
                </dd>
              </div>
              <div>
                <dt className="text-ink-500">GST / Settlement</dt>
                <dd className="text-ink-900">
                  {governance.compliance.gst_applicable
                    ? governance.compliance.gstin_verified ? 'Verified' : 'Pending'
                    : 'Not applicable'}{' '}
                  / {governance.compliance.settlement_verified ? 'Verified' : 'Pending'}
                </dd>
              </div>
            </dl>
          ) : (
            <p className="mt-2 text-xs text-ink-500">
              No compliance review record exists yet for this seller.
            </p>
          )}
          <div className="mt-4 border-t border-ink-100 pt-3">
            <p className="text-xs font-medium text-ink-700">
              Uploaded evidence documents ({governance.documents.length})
            </p>
            {governance.documents.length === 0 ? (
              <p className="mt-1 text-xs text-ink-500">No private verification documents uploaded yet.</p>
            ) : (
              <ul className="mt-2 space-y-1 text-xs text-ink-700">
                {governance.documents.map((doc) => (
                  <li key={doc.id} className="flex items-center justify-between gap-2">
                    <span className="truncate">
                      <span className="font-medium capitalize">{doc.evidence_type.replace(/_/g, ' ')}</span>
                      {doc.file_name ? ` — ${doc.file_name}` : ''}
                    </span>
                    <span className="shrink-0 text-ink-500">{formatIndiaDateTime(doc.created_at)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="mt-3">
            <Link href="/admin/compliance" className="text-xs font-medium text-primary-700 hover:underline">
              Open Compliance Readiness console →
            </Link>
          </div>
        </Card>

        <Card className="p-5">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-ink-800">
            <BarChart3 className="h-4 w-4" aria-hidden /> Order, sales &amp; pricing governance
          </h2>
          <dl className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
            <div className="rounded-lg border border-ink-100 bg-ink-50/40 p-2.5">
              <dt className="text-xs text-ink-500">Sub-orders</dt>
              <dd className="mt-0.5 text-lg font-semibold text-ink-900">{governance.stats.totalSubOrders}</dd>
            </div>
            <div className="rounded-lg border border-ink-100 bg-ink-50/40 p-2.5">
              <dt className="text-xs text-ink-500">Delivered</dt>
              <dd className="mt-0.5 text-lg font-semibold text-ink-900">{governance.stats.deliveredSubOrders}</dd>
            </div>
            <div className="rounded-lg border border-ink-100 bg-ink-50/40 p-2.5">
              <dt className="text-xs text-ink-500">Cancelled / Ret.</dt>
              <dd className="mt-0.5 text-lg font-semibold text-ink-900">{governance.stats.cancelledSubOrders}</dd>
            </div>
            <div className="rounded-lg border border-ink-100 bg-ink-50/40 p-2.5">
              <dt className="text-xs text-ink-500">Gross order value</dt>
              <dd className="mt-0.5 text-sm font-semibold text-ink-900">{inr(governance.stats.grossPaise)}</dd>
            </div>
            <div className="rounded-lg border border-ink-100 bg-ink-50/40 p-2.5">
              <dt className="text-xs text-ink-500">Delivered payable</dt>
              <dd className="mt-0.5 text-sm font-semibold text-ink-900">{inr(governance.stats.deliveredPayablePaise)}</dd>
            </div>
            <div className="rounded-lg border border-ink-100 bg-ink-50/40 p-2.5">
              <dt className="text-xs text-ink-500">Ledger balance ({governance.stats.ledgerEntryCount})</dt>
              <dd className="mt-0.5 text-sm font-semibold text-ink-900">{inr(governance.stats.ledgerNetPaise)}</dd>
            </div>
          </dl>
          <div className="mt-4 border-t border-ink-100 pt-3 text-xs">
            <p className="flex items-center gap-1.5 font-medium text-ink-700">
              <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden /> Wholesale pricing permissions
            </p>
            {governance.pricingPermission ? (
              <p className="mt-1 text-ink-600">
                Max discount: <strong>{governance.pricingPermission.max_discount_percent}%</strong> · Custom slabs:{' '}
                <strong>{governance.pricingPermission.can_set_custom_slabs ? 'Allowed' : 'Disabled'}</strong> · Discounts:{' '}
                <strong>{governance.pricingPermission.can_apply_discounts ? 'Allowed' : 'Disabled'}</strong>
                {governance.pricingPermission.min_moq_override
                  ? ` · Min MOQ: ${governance.pricingPermission.min_moq_override}`
                  : ''}
              </p>
            ) : (
              <p className="mt-1 text-ink-500">Using global Super Admin wholesale pricing rules.</p>
            )}
            <Link
              href="/admin/pricing/wholesale"
              className="mt-2 inline-block font-medium text-primary-700 hover:underline"
            >
              Configure wholesale pricing rules →
            </Link>
          </div>
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

      <Card className="p-5">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-ink-800">
          <History className="h-4 w-4" aria-hidden /> Seller action &amp; moderation history ({governance.history.length})
        </h2>
        {governance.history.length === 0 ? (
          <p className="mt-2 text-sm text-ink-500">No recorded seller governance events yet.</p>
        ) : (
          <ul className="mt-3 divide-y divide-ink-100 text-xs">
            {governance.history.map((event) => (
              <li key={event.id} className="flex flex-wrap items-start justify-between gap-2 py-2">
                <div>
                  <p className="font-medium text-ink-900">{event.summary}</p>
                  {event.reason ? <p className="mt-0.5 text-ink-600">Reason: {event.reason}</p> : null}
                </div>
                <span className="text-ink-500">{formatIndiaDateTime(event.created_at)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>

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
