import Link from 'next/link';
import { ArrowRight, CircleAlert, Clock, History, Ticket } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { requireUser } from '@/lib/auth/session';
import { CouponCard } from '@/components/retailer/coupon-card';
import {
  classifyCoupon,
  couponScopeLabel,
  type ClassifiedCoupon,
  type RetailerCouponRow,
} from '@/lib/retailer/coupon-directory';
import { describeDiscountValue } from '@/lib/coupons/engine';
import { formatInr } from '@/lib/retailer/format';
import { formatIndiaDate } from '@/lib/datetime/india';

interface UsedCouponRow {
  id: string;
  redeemed_at: string;
  discount_amount: number;
  coupons: RetailerCouponRow | null;
  orders: { order_number: string; status: string; placed_at: string } | null;
}

function couponDetails(coupon: RetailerCouponRow): string[] {
  const details: string[] = [];
  if (coupon.minimum_order_value > 0) details.push(`On orders of ${formatInr(coupon.minimum_order_value)} or more`);
  if (coupon.discount_type === 'percentage' && coupon.maximum_discount !== null) {
    details.push(`Up to ${formatInr(coupon.maximum_discount)} off`);
  }
  const scope = couponScopeLabel(coupon);
  if (scope) details.push(`Applies to ${scope}`);
  if (coupon.first_order_only) details.push('First order only');
  if (coupon.usage_limit !== null) details.push(`Limited to ${coupon.usage_limit} uses in total`);
  if (coupon.per_retailer_limit > 1) details.push(`Up to ${coupon.per_retailer_limit} times per shop`);
  return details;
}

function SectionHeading({ icon: Icon, title, subtitle }: { icon: typeof Ticket; title: string; subtitle: string }) {
  return (
    <div className="flex items-center gap-2.5">
      <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary-50 text-primary-600">
        <Icon className="h-4 w-4" aria-hidden="true" />
      </span>
      <div>
        <h2 className="text-sm font-bold text-slate-900">{title}</h2>
        <p className="text-[10px] text-slate-500">{subtitle}</p>
      </div>
    </div>
  );
}

export default async function RetailerCouponsPage() {
  const user = await requireUser();
  const supabase = createClient();
  const now = new Date();

  // RLS shows the caller only ACTIVE coupons (0051 keeps a 30-day expired tail
  // visible so this page can show "recently expired" honestly). Retailer-
  // specific coupons for other shops are filtered in the classifier.
  const [{ data: couponData }, { data: redemptionData }, { count: orderCount }] = await Promise.all([
    supabase
      .from('coupons')
      .select(
        'id, code, title, description, discount_type, discount_value, minimum_order_value, maximum_discount, usage_limit, per_retailer_limit, used_count, starts_at, expires_at, first_order_only, retailer_id, category_id, brand_id, product_id, retailers ( shop_name ), categories ( name ), brands ( name ), products ( name )'
      )
      .eq('is_active', true)
      .order('starts_at', { ascending: false }),
    supabase
      .from('coupon_redemptions')
      .select('id, redeemed_at, discount_amount, coupons ( * ), orders ( order_number, status, placed_at )')
      .eq('retailer_id', user.id)
      .order('redeemed_at', { ascending: false })
      .limit(50),
    // Own orders only (RLS scopes a retailer session to its own rows);
    // cancelled orders do not count against the first-order rule.
    supabase
      .from('orders')
      .select('id', { count: 'exact', head: true })
      .eq('retailer_id', user.id)
      .neq('status', 'cancelled'),
  ]);

  const coupons = (couponData ?? []) as unknown as RetailerCouponRow[];
  const usedRows = (redemptionData ?? []) as unknown as UsedCouponRow[];

  const redemptionsByCoupon: Record<string, number> = {};
  for (const row of usedRows) {
    const couponId = row.coupons?.id;
    if (couponId) redemptionsByCoupon[couponId] = (redemptionsByCoupon[couponId] ?? 0) + 1;
  }

  const classified: ClassifiedCoupon[] = [];
  for (const coupon of coupons) {
    const result = classifyCoupon(coupon, {
      retailerId: user.id,
      now,
      orderCount: orderCount ?? 0,
      redemptionsByCoupon,
    });
    if (result) classified.push(result);
  }

  const available = classified.filter((item) => item.section === 'available');
  const startingSoon = classified.filter((item) => item.section === 'starting_soon');
  const recentlyExpired = classified.filter((item) => item.section === 'recently_expired');

  const cardProps = (item: ClassifiedCoupon) => ({
    code: item.coupon.code,
    title: item.coupon.title,
    discountLabel: describeDiscountValue(item.coupon),
    details: couponDetails(item.coupon),
    expiresLabel: formatIndiaDate(item.coupon.expires_at),
    blockedReason: item.blockedReason,
    scheduled: item.section === 'starting_soon',
  });

  return (
    <div className="space-y-6 pb-24 sm:space-y-7 lg:pb-0">
      <div>
        <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-primary-600">Saves &amp; offers</p>
        <h1 className="mt-1 text-xl font-bold tracking-tight text-slate-950 sm:text-2xl">Coupons &amp; offers</h1>
        <p className="mt-1 text-xs text-slate-500">
          Codes you can use on your next order. Every code is checked on our servers before it is applied.
        </p>
      </div>

      {available.length === 0 && startingSoon.length === 0 && recentlyExpired.length === 0 ? (
        <section className="flex min-h-[280px] flex-col items-center justify-center rounded-2xl border border-slate-200 bg-white px-5 py-12 text-center">
          <span className="flex h-16 w-16 items-center justify-center rounded-full bg-primary-50 text-primary-600">
            <Ticket className="h-7 w-7" aria-hidden="true" />
          </span>
          <h2 className="mt-4 text-base font-bold text-slate-900">No coupons right now</h2>
          <p className="mt-2 max-w-xs text-xs leading-5 text-slate-500">
            When Maharani Traders launches an offer for your shop, the code will appear here — check back after your next order.
          </p>
          <Link
            href="/retailer/catalog"
            className="mt-5 flex h-10 items-center gap-2 rounded-xl bg-primary-600 px-4 text-xs font-bold text-white shadow-sm transition hover:bg-primary-700"
          >
            Browse the catalog <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Link>
        </section>
      ) : null}

      {available.length > 0 ? (
        <section className="space-y-3" aria-label="Available coupons">
          <SectionHeading icon={Ticket} title="Available now" subtitle="Apply one to your cart — the discount is verified server-side." />
          <div className="grid gap-3 sm:grid-cols-2">
            {available.map((item) => (
              <CouponCard key={item.coupon.id} {...cardProps(item)} />
            ))}
          </div>
        </section>
      ) : null}

      {startingSoon.length > 0 ? (
        <section className="space-y-3" aria-label="Starting soon">
          <SectionHeading icon={Clock} title="Starting soon" subtitle="These codes go live in their start window." />
          <div className="grid gap-3 sm:grid-cols-2">
            {startingSoon.map((item) => (
              <CouponCard key={item.coupon.id} {...cardProps(item)} />
            ))}
          </div>
        </section>
      ) : null}

      {usedRows.length > 0 ? (
        <section className="space-y-3" aria-label="Your used coupons">
          <SectionHeading icon={History} title="Your used coupons" subtitle="Recent redemptions on your orders." />
          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <ul className="divide-y divide-slate-100">
              {usedRows.map((row) => {
                const coupon = row.coupons;
                const isCancelled = row.orders?.status === 'cancelled';
                return (
                  <li key={row.id} className="flex items-center justify-between gap-3 px-4 py-3">
                    <div className="min-w-0">
                      <p className="truncate font-mono text-xs font-bold tracking-wider text-slate-900">
                        {coupon?.code ?? 'REMOVED CODE'}
                      </p>
                      <p className="mt-0.5 truncate text-[10px] text-slate-500">
                        {row.orders ? `Order ${row.orders.order_number} · ${formatIndiaDate(row.orders.placed_at)}` : formatIndiaDate(row.redeemed_at)}
                      </p>
                    </div>
                    {isCancelled ? (
                      <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-500">Order cancelled</span>
                    ) : (
                      <span className="shrink-0 text-xs font-bold text-emerald-700">−{formatInr(row.discount_amount)}</span>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        </section>
      ) : null}

      {recentlyExpired.length > 0 ? (
        <section className="space-y-3" aria-label="Recently expired">
          <SectionHeading icon={CircleAlert} title="Recently expired" subtitle="Kept for 30 days so you know the code is over." />
          <div className="grid gap-3 sm:grid-cols-2">
            {recentlyExpired.map((item) => (
              <CouponCard key={item.coupon.id} {...cardProps(item)} />
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
