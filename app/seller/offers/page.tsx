import { Tag } from 'lucide-react';
import { requireSellerPage } from '@/lib/seller/guard';
import { listCataloguePacksForSeller, listSellerOffers } from '@/lib/seller/queries';
import { SellerCreateOfferCard, SellerOfferCard } from '@/components/seller/seller-offer-manager';
import { Card } from '@/components/ui/card';

export const dynamic = 'force-dynamic';

export default async function SellerOffersPage() {
  const { seller } = await requireSellerPage();
  const [offers, packs] = await Promise.all([
    listSellerOffers(seller.id),
    listCataloguePacksForSeller(),
  ]);

  const isSellerActive = seller.status === 'active';

  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold text-slate-900">
          <Tag className="h-6 w-6 text-primary-600" /> Offers, Stock &amp; Quantity-Tier Pricing
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          Create offers on central-catalogue packs, configure quantity-tier discounts, and manage your seller-owned
          on-hand stock. Commercial edits (price, MOQ, SKU, quantity tiers) require admin approval before going live.
        </p>
      </div>

      {!isSellerActive ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-xs text-amber-900">
          Your seller account status is <strong>{seller.status}</strong>. Offer creation and updates are enabled once
          your seller account is <strong>active</strong>.
        </div>
      ) : null}

      <Card className="p-5">
        <h2 className="text-sm font-bold text-slate-900">Create a new marketplace offer</h2>
        <p className="mt-1 mb-4 text-xs text-slate-500">
          Select a pack from the Maharani central catalogue. New offers start in pending moderation.
        </p>
        <SellerCreateOfferCard packs={packs} disabled={!isSellerActive} />
      </Card>

      <div className="space-y-4">
        <h2 className="text-sm font-bold text-slate-900">Your offers ({offers.length})</h2>
        {offers.length === 0 ? (
          <Card className="p-6 text-center text-xs text-slate-500">
            You have not created any offers yet. Use the form above to submit your first pack offer.
          </Card>
        ) : (
          offers.map((offer) => (
            <SellerOfferCard key={offer.id} offer={offer} disabled={!isSellerActive} />
          ))
        )}
      </div>
    </div>
  );
}
