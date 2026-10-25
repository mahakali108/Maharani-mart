import Link from 'next/link';
import { Crown, ChevronRight, CheckCircle2, Clock, Award } from 'lucide-react';
import { requireUser } from '@/lib/auth/session';
import { createClient } from '@/lib/supabase/server';
import {
  getAuthoritativeActiveMembership,
  listAvailableMembershipPlans,
  getRetailerMembershipHistory,
  getRetailerLoyaltyPosition,
  getRetailerLoyaltyLedger,
} from '@/lib/membership/server';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ReadFailureNotice } from '@/components/ui/read-failure-notice';
import { formatIndiaDateTime } from '@/lib/datetime/india';

export const dynamic = 'force-dynamic';

export default async function RetailerMembershipPage() {
  const user = await requireUser();
  const supabase = createClient();

  const [membershipRes, plansRes, historyRes, loyaltyBalRes, loyaltyLedgerRes] = await Promise.all([
    getAuthoritativeActiveMembership(supabase, user.id),
    listAvailableMembershipPlans(supabase),
    getRetailerMembershipHistory(supabase, user.id),
    getRetailerLoyaltyPosition(supabase, user.id),
    getRetailerLoyaltyLedger(supabase, user.id, 10),
  ]);

  const readFailed = Boolean(
    membershipRes.error || plansRes.error || historyRes.error || loyaltyBalRes.error || loyaltyLedgerRes.error
  );
  const readFailureMessage =
    membershipRes.error ?? plansRes.error ?? historyRes.error ?? loyaltyBalRes.error ?? loyaltyLedgerRes.error ?? null;

  const activeMembership = membershipRes.membership;
  const plans = plansRes.plans;
  const history = historyRes.history;
  const loyaltyBalance = loyaltyBalRes.balance;
  const loyaltyLedger = loyaltyLedgerRes.entries;

  const currentTier = activeMembership?.tier ?? 'free';

  return (
    <div className="space-y-6 sm:space-y-7">
      <div className="flex items-center gap-1.5 text-[10px] font-semibold text-slate-500 sm:text-xs">
        <Link href="/retailer/home" className="hover:text-primary-600">
          Home
        </Link>
        <ChevronRight className="h-3 w-3" />
        <Link href="/retailer/account" className="hover:text-primary-600">
          Account
        </Link>
        <ChevronRight className="h-3 w-3" />
        <span className="text-slate-800">Membership & Loyalty</span>
      </div>

      {readFailed && (
        <ReadFailureNotice what="Membership and loyalty account details" detail={readFailureMessage} />
      )}

      {/* Active Membership Hero */}
      <section className="relative overflow-hidden rounded-2xl border border-amber-200 bg-gradient-to-br from-amber-50 via-peach-50 to-amber-100/40 p-6 shadow-sm">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/10 px-3 py-1 text-xs font-semibold text-amber-900">
              <Crown className="h-3.5 w-3.5 text-amber-600" />
              <span className="capitalize">{currentTier} Tier Active</span>
            </div>
            <h1 className="mt-2 text-2xl font-bold text-slate-900">
              {currentTier === 'gold' ? 'Gold VIP Club' : currentTier === 'silver' ? 'Silver Executive Club' : 'Standard Free Membership'}
            </h1>
            <p className="mt-1 text-sm text-slate-600">
              {currentTier === 'free'
                ? 'Upgrade to Silver or Gold to unlock instant order discounts and 2x loyalty points.'
                : `Enjoying ${activeMembership?.discount_percent}% off orders and ${activeMembership?.points_multiplier}x loyalty points multiplier.`}
            </p>
          </div>

          <div className="rounded-xl bg-white/80 p-4 backdrop-blur shadow-sm border border-amber-100 flex items-center gap-4">
            <Award className="h-10 w-10 text-amber-500" />
            <div>
              <p className="text-xs font-medium text-slate-500">Loyalty Balance</p>
              <p className="text-xl font-bold text-slate-900">{loyaltyBalance} Points</p>
              <p className="text-[10px] text-slate-400">Earned on confirmed orders</p>
            </div>
          </div>
        </div>

        {activeMembership?.expires_at && (
          <div className="mt-4 flex items-center gap-2 text-xs font-medium text-amber-800">
            <Clock className="h-4 w-4" />
            <span>Valid until: {formatIndiaDateTime(activeMembership.expires_at)}</span>
          </div>
        )}
      </section>

      {/* Available Plans & Upgrades */}
      <section className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">Membership Tiers & Benefits</h2>
          <p className="text-xs text-slate-500">Select a plan to request an upgrade or renewal through Maharani Traders support.</p>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          {plans.map((plan) => {
            const isCurrent = plan.tier === currentTier;
            return (
              <Card key={plan.id} className={`flex flex-col justify-between border ${isCurrent ? 'border-primary-500 ring-2 ring-primary-500/20' : 'border-slate-200'}`}>
                <div>
                  <CardHeader>
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-base font-semibold text-slate-900">{plan.name}</CardTitle>
                      {isCurrent && (
                        <span className="rounded-full bg-primary-100 px-2 py-0.5 text-[10px] font-bold text-primary-800">
                          ACTIVE
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-slate-500">{plan.description}</p>
                    <div className="mt-2 text-2xl font-bold text-slate-900">
                      {plan.price_paise === 0 ? '₹0' : `₹${(plan.price_paise / 100).toFixed(0)}`}
                      <span className="text-xs font-normal text-slate-500"> / {plan.duration_days} days</span>
                    </div>
                  </CardHeader>

                  <div className="space-y-4 px-1 pb-4">
                    <div className="space-y-2 text-xs text-slate-700">
                      <div className="flex items-center gap-1.5">
                        <CheckCircle2 className="h-4 w-4 text-mint-600" />
                        <span><strong>{plan.discount_percent}%</strong> extra order discount</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <CheckCircle2 className="h-4 w-4 text-mint-600" />
                        <span><strong>{plan.points_multiplier}x</strong> loyalty points acceleration</span>
                      </div>
                      {Array.isArray(plan.features) && plan.features.map((feat, i) => (
                        <div key={i} className="flex items-center gap-1.5">
                          <CheckCircle2 className="h-4 w-4 text-mint-600" />
                          <span>{feat}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="pt-2">
                  {isCurrent ? (
                    <Button variant="outline" disabled className="w-full text-xs">
                      Current Plan
                    </Button>
                  ) : (
                    <Link href={`/retailer/support?topic=membership&plan=${plan.id}`} className="block">
                      <Button variant="secondary" className="w-full text-xs">
                        Request Upgrade (Admin-managed)
                      </Button>
                    </Link>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      </section>

      {/* Loyalty Points History */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-900">Loyalty Points Activity</h2>
          <span className="text-xs text-slate-500">Append-only ledger</span>
        </div>

        {loyaltyLedger.length === 0 ? (
          <Card className="p-6 text-center text-sm text-slate-500">
            No loyalty point transactions recorded yet. Complete orders to earn points!
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

      {/* Subscription History */}
      <section className="space-y-4">
        <h2 className="text-lg font-semibold text-slate-900">Subscription History</h2>
        {history.length === 0 ? (
          <Card className="p-6 text-center text-sm text-slate-500">
            Standard Free tier active. No previous paid subscription records found.
          </Card>
        ) : (
          <Card className="table-scroll p-0">
            <table className="w-full text-sm">
              <thead className="border-b border-slate-100 bg-slate-50 text-left text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Plan</th>
                  <th className="px-4 py-2.5 font-medium">Status</th>
                  <th className="px-4 py-2.5 font-medium">Start Date</th>
                  <th className="px-4 py-2.5 font-medium">Expiry Date</th>
                  <th className="px-4 py-2.5 text-right font-medium">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {history.map((h) => (
                  <tr key={h.id}>
                    <td className="px-4 py-2 text-xs font-medium text-slate-900 capitalize">{h.tier}</td>
                    <td className="px-4 py-2 text-xs">
                      <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
                        h.status === 'active' ? 'bg-mint-100 text-mint-800' : 'bg-slate-100 text-slate-600'
                      }`}>
                        {h.status}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-xs text-slate-500">{formatIndiaDateTime(h.starts_at)}</td>
                    <td className="px-4 py-2 text-xs text-slate-500">{h.expires_at ? formatIndiaDateTime(h.expires_at) : 'Perpetual'}</td>
                    <td className="px-4 py-2 text-right text-xs text-slate-700">₹{(h.amount_paid_paise / 100).toFixed(2)}</td>
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
