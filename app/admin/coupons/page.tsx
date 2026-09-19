import Link from 'next/link';
import { Plus, Ticket } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { requirePermission } from '@/lib/admin/guard';
import { Card } from '@/components/ui/card';
import { AdminEmptyState } from '@/components/admin/empty-state';
import { describeDiscountValue } from '@/lib/coupons/engine';
import { formatIndiaDateTime } from '@/lib/datetime/india';

interface CouponRow {
  id: string;
  code: string;
  title: string;
  description: string | null;
  discount_type: 'percentage' | 'fixed';
  discount_value: number;
  minimum_order_value: number;
  maximum_discount: number | null;
  usage_limit: number | null;
  per_retailer_limit: number;
  used_count: number;
  starts_at: string;
  expires_at: string;
  is_active: boolean;
  first_order_only: boolean;
  retailers: { shop_name: string } | null;
  categories: { name: string } | null;
  brands: { name: string } | null;
  products: { name: string } | null;
  created_at: string;
}

function scopeLabel(coupon: CouponRow): string {
  const parts: string[] = [];
  if (coupon.retailers) parts.push(`Retailer: ${coupon.retailers.shop_name}`);
  if (coupon.categories) parts.push(`Category: ${coupon.categories.name}`);
  if (coupon.brands) parts.push(`Brand: ${coupon.brands.name}`);
  if (coupon.products) parts.push(`Product: ${coupon.products.name}`);
  return parts.length > 0 ? parts.join(' · ') : 'Whole cart';
}

function CouponState({ coupon, now }: { coupon: CouponRow; now: number }) {
  if (!coupon.is_active) {
    return <span className="rounded-full bg-ink-100 px-2 py-0.5 text-xs font-medium text-ink-500">Deactivated</span>;
  }
  const exhausted = coupon.usage_limit !== null && coupon.used_count >= coupon.usage_limit;
  if (exhausted) {
    return <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">Uses exhausted</span>;
  }
  if (new Date(coupon.expires_at).getTime() <= now) {
    return <span className="rounded-full bg-ink-100 px-2 py-0.5 text-xs font-medium text-ink-500">Expired</span>;
  }
  if (new Date(coupon.starts_at).getTime() > now) {
    return <span className="rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700">Scheduled</span>;
  }
  return <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">Running</span>;
}

export default async function AdminCouponsPage() {
  await requirePermission('pricing.manage');
  const supabase = createClient();

  const { data } = await supabase
    .from('coupons')
    .select('id, code, title, description, discount_type, discount_value, minimum_order_value, maximum_discount, usage_limit, per_retailer_limit, used_count, starts_at, expires_at, is_active, first_order_only, retailers ( shop_name ), categories ( name ), brands ( name ), products ( name ), created_at')
    .order('created_at', { ascending: false })
    .returns<CouponRow[]>();

  const coupons = data ?? [];
  const now = Date.now();

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-ink-950">Coupons</h1>
          <p className="mt-1 text-sm text-ink-500">
            Promotional codes for the retailer cart. Discount, eligibility and limits are enforced server-side on every order. Every change is audit-logged.
          </p>
        </div>
        <Link
          href="/admin/coupons/new"
          className="flex h-10 items-center gap-2 rounded-xl bg-primary-600 px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-primary-700"
        >
          <Plus className="h-4 w-4" /> New coupon
        </Link>
      </div>

      {coupons.length === 0 ? (
        <AdminEmptyState
          icon={Ticket}
          title="No coupons yet"
          body="Create a coupon code to offer percentage or fixed discounts with minimum order values, usage limits and product scoping."
        />
      ) : (
        <Card className="table-scroll p-0">
          <table className="w-full min-w-[860px] text-sm">
            <thead className="border-b border-ink-100 bg-ink-50 text-left text-xs uppercase tracking-wide text-ink-500">
              <tr>
                <th className="px-5 py-3 font-medium">Code</th>
                <th className="px-5 py-3 font-medium">Discount</th>
                <th className="px-5 py-3 font-medium">Applies to</th>
                <th className="px-5 py-3 font-medium">Window</th>
                <th className="px-5 py-3 font-medium">Usage</th>
                <th className="px-5 py-3 font-medium">State</th>
                <th className="px-5 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-100">
              {coupons.map((coupon) => (
                <tr key={coupon.id} className="align-top">
                  <td className="px-5 py-3">
                    <p className="font-mono text-sm font-semibold tracking-wide text-ink-900">{coupon.code}</p>
                    <p className="mt-0.5 text-xs text-ink-500">{coupon.title}</p>
                    {coupon.first_order_only ? (
                      <p className="mt-0.5 text-xs text-ink-400">First order only</p>
                    ) : null}
                  </td>
                  <td className="px-5 py-3 text-xs text-ink-600">
                    <p className="font-medium text-ink-800">{describeDiscountValue(coupon)}</p>
                    <p className="mt-0.5">
                      Min order ₹{coupon.minimum_order_value.toFixed(2)}
                      {coupon.discount_type === 'percentage' && coupon.maximum_discount !== null
                        ? ` · capped at ₹${coupon.maximum_discount.toFixed(2)}`
                        : ''}
                    </p>
                  </td>
                  <td className="px-5 py-3 text-xs text-ink-600">{scopeLabel(coupon)}</td>
                  <td className="px-5 py-3 text-xs text-ink-600">
                    {formatIndiaDateTime(coupon.starts_at)} → {formatIndiaDateTime(coupon.expires_at)}
                  </td>
                  <td className="px-5 py-3 text-xs text-ink-600">
                    {coupon.usage_limit === null ? (
                      <span>
                        {coupon.used_count} used · unlimited
                      </span>
                    ) : (
                      <span>
                        {coupon.used_count} / {coupon.usage_limit}
                      </span>
                    )}
                    <p className="mt-0.5 text-ink-400">{coupon.per_retailer_limit} per retailer</p>
                  </td>
                  <td className="px-5 py-3">
                    <CouponState coupon={coupon} now={now} />
                  </td>
                  <td className="px-5 py-3 text-right">
                    <Link
                      href={`/admin/coupons/${coupon.id}`}
                      className="text-xs font-semibold text-primary-600 hover:text-primary-700"
                    >
                      Edit
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
