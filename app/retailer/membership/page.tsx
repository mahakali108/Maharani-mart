import Link from 'next/link';
import { Award, ChevronRight, Info, ShieldCheck } from 'lucide-react';
import { requireUser } from '@/lib/auth/session';
import { createClient } from '@/lib/supabase/server';
import { getRetailerLoyaltyPosition, getRetailerLoyaltyLedger } from '@/lib/membership/server';
import { loadRetailerCategory } from '@/lib/retailer/category-pricing';
import { RETAILER_CATEGORY_LABELS } from '@/lib/pricing/category-pricing';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { ReadFailureNotice } from '@/components/ui/read-failure-notice';
import { formatIndiaDateTime } from '@/lib/datetime/india';

export const dynamic = 'force-dynamic';

/**
 * Retailer pricing category + loyalty points.
 *
 * The paid Silver/Gold membership subscription was retired (owner decision,
 * migration 0083). A retailer's category is an ADMIN-ASSIGNED classification,
 * not a purchase: there is no plan, no fee, no renewal and no expiry, and the
 * screen never advertises a "buy" action.
 *
 * The loyalty points ledger is retained as an independent, auditable record.
 * Historic balances are shown exactly as recorded and are never converted to
 * cash or silently adjusted.
 */
export default async function RetailerCategoryPage() {
  const user = await requireUser();
  const supabase = (await createClient());

  const [category, loyaltyBalRes, loyaltyLedgerRes] = await Promise.all([
    loadRetailerCategory(supabase, user.id).catch(() => 'general' as const),
    getRetailerLoyaltyPosition(supabase, user.id),
    getRetailerLoyaltyLedger(supabase, user.id, 20),
  ]);

  const readFailureMessage = loyaltyBalRes.error ?? loyaltyLedgerRes.error ?? null;
  const loyaltyBalance = loyaltyBalRes.balance;
  const loyaltyLedger = loyaltyLedgerRes.entries;
  const label = RETAILER_CATEGORY_LABELS[category];

  return (
    <div className="space-y-6 sm:space-y-7">
      <div className="flex flex-wrap items-center gap-1.5 text-[10px] font-semibold text-slate-500 sm:text-xs">
        <Link href="/retailer/home" className="hover:text-primary-600">
          Home
        </Link>
        <ChevronRight className="h-3 w-3" />
        <Link href="/retailer/account" className="hover:text-primary-600">
          Account
        </Link>
        <ChevronRight className="h-3 w-3" />
        <span className="text-slate-800">Pricing Category &amp; Points</span>
      </div>

      {readFailureMessage && <ReadFailureNotice what="Your pricing category and loyalty points" detail={readFailureMessage} />}

      <section className="relative overflow-hidden rounded-2xl border border-primary-200 bg-gradient-to-br from-primary-50 via-white to-primary-100/40 p-5 shadow-sm sm:p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="inline-flex items-center gap-1.5 rounded-full bg-primary-600/10 px-3 py-1 text-xs font-semibold text-primary-800">
              <ShieldCheck className="h-3.5 w-3.5" />
              <span>{label.en}</span>
            </div>
            <h1 className="mt-2 text-xl font-bold text-slate-900 sm:text-2xl">{label.hi}</h1>
            <p className="mt-1 max-w-xl text-sm text-slate-600">
              Your account has been assigned the <strong>{label.en}</strong> pricing category by Maharani Traders:
              {' '}
              {label.description} The price shown on every product is the price you will be charged at checkout.
            </p>
          </div>

          <div className="flex items-center gap-4 rounded-xl border border-primary-100 bg-white/80 p-4 shadow-sm backdrop-blur">
            <Award className="h-10 w-10 text-primary-500" />
            <div>
              <p className="text-xs font-medium text-slate-500">Loyalty points</p>
              <p className="text-xl font-bold text-slate-900">{loyaltyBalance} pts</p>
              <p className="text-[10px] text-slate-400">Earned on delivered orders</p>
            </div>
          </div>
        </div>
      </section>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-1.5 text-base">
            <Info className="h-4 w-4 text-ink-400" /> How pricing categories work
          </CardTitle>
        </CardHeader>
        <ul className="list-disc space-y-1.5 pl-5 text-xs text-slate-600">
          <li>Categories are reviewed and assigned by Maharani Traders administrators — they are not purchased.</li>
          <li>There is no membership fee, no subscription and no expiry date on your category.</li>
          <li>
            If your business details or volumes change, contact support and an administrator can review your category;
            every change is recorded with a reason.
          </li>
          <li>Your category price applies to Maharani own-stock items; third-party seller offers keep their own approved price.</li>
          <li>Loyalty points are a record of past activity. They are not cash and are never converted to money automatically.</li>
        </ul>
        <div className="mt-3">
          <Link href="/retailer/support" className="text-xs font-semibold text-primary-700 hover:underline">
            Contact support about your pricing category →
          </Link>
        </div>
      </Card>

      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-900">Loyalty points activity</h2>
          <span className="text-xs text-slate-500">Append-only ledger</span>
        </div>

        {loyaltyLedger.length === 0 ? (
          <Card className="p-6 text-center text-sm text-slate-500">
            No loyalty point entries yet. Points are added when an order is delivered.
          </Card>
        ) : (
          <Card className="table-scroll p-0">
            <table className="w-full text-sm">
              <thead className="border-b border-slate-100 bg-slate-50 text-left text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Date</th>
                  <th className="px-4 py-2.5 font-medium">Activity</th>
                  <th className="px-4 py-2.5 font-medium">Reason</th>
                  <th className="px-4 py-2.5 text-right font-medium">Points</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {loyaltyLedger.map((entry) => (
                  <tr key={entry.id}>
                    <td className="px-4 py-2 text-xs text-slate-500">{formatIndiaDateTime(entry.created_at)}</td>
                    <td className="px-4 py-2 text-xs font-medium text-slate-800">{entry.entry_type}</td>
                    <td className="px-4 py-2 text-xs text-slate-600">{entry.reason}</td>
                    <td className={`px-4 py-2 text-right text-xs font-semibold ${entry.points > 0 ? 'text-mint-700' : 'text-slate-700'}`}>
                      {entry.points > 0 ? `+${entry.points}` : entry.points}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        )}
      </section>
    </div>
  );
}
