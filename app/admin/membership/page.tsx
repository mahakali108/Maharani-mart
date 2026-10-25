import { Crown } from 'lucide-react';
import { requirePagePermission } from '@/lib/admin/guard';
import { createClient } from '@/lib/supabase/server';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { formatIndiaDateTime } from '@/lib/datetime/india';
import { adminAssignRetailerMembershipAction, adminRecordLoyaltyPointsAction } from '@/lib/membership/actions';
import type { MembershipPlan } from '@/lib/membership/types';

export const dynamic = 'force-dynamic';

interface MembershipRow {
  id: string;
  retailer_id: string;
  plan_id: string;
  tier: string;
  status: string;
  starts_at: string;
  expires_at: string | null;
  payment_reference: string | null;
  retailers: { shop_name: string } | null;
}

interface RetailerOption {
  id: string;
  shop_name: string;
}

export default async function AdminMembershipPage() {
  await requirePagePermission('pricing.manage');
  const supabase = createClient();

  const [plansResult, membershipsResult, retailersResult] = await Promise.all([
    supabase.from('membership_plans' as never).select('*').order('price_paise', { ascending: true }),
    supabase.from('retailer_memberships' as never).select('*, retailers(shop_name)').order('created_at', { ascending: false }).limit(25),
    supabase.from('retailers').select('id, shop_name').order('shop_name', { ascending: true }),
  ]);

  const plans = (plansResult.data as unknown as MembershipPlan[]) ?? [];
  const memberships = (membershipsResult.data as unknown as MembershipRow[]) ?? [];
  const retailers = (retailersResult.data as unknown as RetailerOption[]) ?? [];

  return (
    <div className="space-y-6">
      <header>
        <h1 className="flex items-center gap-2 text-2xl font-semibold text-ink-950">
          <Crown className="h-6 w-6 text-amber-500" aria-hidden /> Memberships & Loyalty Configuration
        </h1>
        <p className="mt-1 text-sm text-ink-500">
          Super Admin and Admin control center for B2B Retailer Memberships (Free, Silver, Gold) and auditable loyalty points.
        </p>
      </header>

      {/* Plan Configurations */}
      <section className="space-y-4">
        <h2 className="text-lg font-medium text-ink-900">Configured Membership Plans</h2>
        <div className="grid gap-4 sm:grid-cols-3">
          {plans.map((p) => (
            <Card key={p.id} className="relative border-ink-200">
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="capitalize text-ink-900">{p.name}</CardTitle>
                  <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                    p.tier === 'gold' ? 'bg-amber-100 text-amber-800' :
                    p.tier === 'silver' ? 'bg-slate-200 text-slate-800' :
                    'bg-mint-100 text-mint-800'
                  }`}>
                    {p.tier.toUpperCase()}
                  </span>
                </div>
              </CardHeader>
              <div className="space-y-2 text-sm text-ink-600">
                <p className="text-xl font-bold text-ink-950">
                  {p.price_paise === 0 ? 'Free' : `₹${(p.price_paise / 100).toFixed(2)}`}
                  <span className="text-xs font-normal text-ink-500"> / {p.duration_days} days</span>
                </p>
                <p className="text-xs text-ink-500">{p.description}</p>
                <div className="mt-2 border-t border-ink-100 pt-2 text-xs space-y-1">
                  <div>Order Discount: <strong className="text-ink-900">{p.discount_percent}%</strong></div>
                  <div>Points Multiplier: <strong className="text-ink-900">{p.points_multiplier}x</strong></div>
                </div>
              </div>
            </Card>
          ))}
        </div>
      </section>

      {/* Assign Membership Form */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base font-medium text-ink-900">Assign or Activate Retailer Plan</CardTitle>
        </CardHeader>
        <form action={adminAssignRetailerMembershipAction} className="grid gap-4 sm:grid-cols-4">
          <div>
            <label className="text-xs font-medium text-ink-700">Retailer</label>
            <Select name="retailerId" required className="mt-1">
              <option value="">Select retailer...</option>
              {retailers.map((r) => (
                <option key={r.id} value={r.id}>{r.shop_name}</option>
              ))}
            </Select>
          </div>
          <div>
            <label className="text-xs font-medium text-ink-700">Plan</label>
            <Select name="planId" required className="mt-1">
              {plans.map((p) => (
                <option key={p.id} value={p.id}>{p.name} ({p.tier})</option>
              ))}
            </Select>
          </div>
          <div>
            <label className="text-xs font-medium text-ink-700">Payment Ref / Offline Note</label>
            <Input name="paymentRef" placeholder="e.g. Bank Transfer #1042" className="mt-1" />
          </div>
          <div className="flex items-end">
            <Button type="submit" className="w-full">Activate Plan</Button>
          </div>
        </form>
      </Card>

      {/* Adjust Loyalty Points Form */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base font-medium text-ink-900">Manual Loyalty Points Adjustment</CardTitle>
        </CardHeader>
        <form action={adminRecordLoyaltyPointsAction} className="grid gap-4 sm:grid-cols-5">
          <div>
            <label className="text-xs font-medium text-ink-700">Retailer</label>
            <Select name="retailerId" required className="mt-1">
              <option value="">Select retailer...</option>
              {retailers.map((r) => (
                <option key={r.id} value={r.id}>{r.shop_name}</option>
              ))}
            </Select>
          </div>
          <div>
            <label className="text-xs font-medium text-ink-700">Points (+ credit / - debit)</label>
            <Input name="points" type="number" required placeholder="+100 or -50" className="mt-1" />
          </div>
          <div>
            <label className="text-xs font-medium text-ink-700">Type</label>
            <Select name="entryType" defaultValue="MANUAL_CREDIT" className="mt-1">
              <option value="MANUAL_CREDIT">Manual Credit</option>
              <option value="MANUAL_DEBIT">Manual Debit</option>
            </Select>
          </div>
          <div>
            <label className="text-xs font-medium text-ink-700">Reason</label>
            <Input name="reason" required placeholder="Reason for adjustment" className="mt-1" />
          </div>
          <div className="flex items-end">
            <Button type="submit" variant="secondary" className="w-full">Adjust Points</Button>
          </div>
        </form>
      </Card>

      {/* Recent Memberships Table */}
      <section className="space-y-2">
        <h2 className="text-lg font-medium text-ink-900">Recent Membership Activations</h2>
        <Card className="table-scroll p-0">
          <table className="w-full text-sm">
            <thead className="border-b border-ink-100 bg-ink-50 text-left text-xs uppercase text-ink-500">
              <tr>
                <th className="px-4 py-2 font-medium">Retailer</th>
                <th className="px-4 py-2 font-medium">Plan</th>
                <th className="px-4 py-2 font-medium">Status</th>
                <th className="px-4 py-2 font-medium">Started</th>
                <th className="px-4 py-2 font-medium">Expires</th>
                <th className="px-4 py-2 font-medium">Payment Ref</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-100">
              {memberships.map((m) => (
                <tr key={m.id}>
                  <td className="px-4 py-2 font-medium text-ink-900">{m.retailers?.shop_name ?? m.retailer_id}</td>
                  <td className="px-4 py-2 capitalize">{m.tier}</td>
                  <td className="px-4 py-2">
                    <span className={`rounded px-2 py-0.5 text-xs font-medium ${
                      m.status === 'active' ? 'bg-mint-100 text-mint-800' : 'bg-ink-100 text-ink-600'
                    }`}>
                      {m.status}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-xs text-ink-500">{formatIndiaDateTime(m.starts_at)}</td>
                  <td className="px-4 py-2 text-xs text-ink-500">{m.expires_at ? formatIndiaDateTime(m.expires_at) : 'Perpetual'}</td>
                  <td className="px-4 py-2 text-xs text-ink-500">{m.payment_reference || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </section>
    </div>
  );
}
