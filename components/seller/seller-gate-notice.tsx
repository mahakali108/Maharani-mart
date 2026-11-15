import Link from 'next/link';

import { checkSellerOfferGate } from '@/lib/seller/offer-gate';
import { createClient } from '@/lib/supabase/server';

/**
 * Tells a seller, before they try anything, why an offer cannot go live:
 * the marketplace is closed, or the current Seller Agreement has not been
 * accepted by the business owner. Renders nothing when the gate is open.
 * Display only — the database (0098) and the server actions enforce the gate.
 */
export async function SellerGateNotice({ sellerId, memberRole }: { sellerId: string; memberRole: 'owner' | 'member' }) {
  const gate = await checkSellerOfferGate(await createClient(), sellerId);
  if (gate.open) return null;

  if (gate.reason === 'marketplace') {
    return (
      <section role="status" aria-labelledby="seller-gate-heading" className="rounded-2xl border border-slate-300 bg-slate-100 p-4 text-sm text-slate-800">
        <h2 id="seller-gate-heading" className="font-bold text-slate-900">The marketplace is not open to sellers yet</h2>
        <p className="mt-1 text-xs leading-5">
          Offers cannot be put on sale at the moment. This applies to every seller and is not a problem with your
          account. You can still prepare your business profile, and deactivate offers or correct stock. We will
          tell you when selling opens.
        </p>
      </section>
    );
  }

  if (gate.reason === 'agreement') {
    return (
      <section role="status" aria-labelledby="seller-gate-heading" className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
        <h2 id="seller-gate-heading" className="font-bold">The current Seller Agreement needs to be accepted</h2>
        <p className="mt-1 text-xs leading-5">
          {memberRole === 'owner'
            ? 'Your offers cannot go live until you accept the current version of the Seller Agreement.'
            : 'Your offers cannot go live until the owner of this seller business accepts the current version of the Seller Agreement. Only the owner can accept it.'}
        </p>
        <div className="mt-2 flex flex-wrap gap-x-4">
          <Link href="/legal/seller-agreement" className="inline-flex min-h-11 items-center text-xs font-bold underline">Read the Seller Agreement</Link>
          {memberRole === 'owner' ? (
            <Link href="/seller/profile" className="inline-flex min-h-11 items-center text-xs font-bold underline">Go to Business Profile to accept</Link>
          ) : null}
        </div>
      </section>
    );
  }

  return (
    <section role="status" aria-labelledby="seller-gate-heading" className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
      <h2 id="seller-gate-heading" className="font-bold">Offers cannot go live right now</h2>
      <p className="mt-1 text-xs leading-5">
        We could not confirm the marketplace status or your Seller Agreement acceptance, so offers stay off sale.
        Nothing is wrong with your saved data. Please try again later or contact support.
      </p>
    </section>
  );
}
