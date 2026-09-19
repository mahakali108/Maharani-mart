import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Ticket } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { requirePermission } from '@/lib/admin/guard';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { CouponForm, type Option } from '@/components/admin/coupon-form';
import { AdminEmptyState } from '@/components/admin/empty-state';
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
  retailer_id: string | null;
  category_id: string | null;
  brand_id: string | null;
  product_id: string | null;
  created_at: string;
}

export default async function AdminCouponEditPage({ params }: { params: { id: string } }) {
  await requirePermission('pricing.manage');
  const supabase = createClient();

  const [{ data: coupon }, { data: retailerData }, { data: categoryData }, { data: brandData }, { data: productData }] =
    await Promise.all([
      supabase
        .from('coupons')
        .select(
          'id, code, title, description, discount_type, discount_value, minimum_order_value, maximum_discount, usage_limit, per_retailer_limit, used_count, starts_at, expires_at, is_active, first_order_only, retailer_id, category_id, brand_id, product_id, created_at'
        )
        .eq('id', params.id)
        .maybeSingle<CouponRow>(),
      supabase.from('retailers').select('id, shop_name').eq('status', 'active').order('shop_name'),
      supabase.from('categories').select('id, name').eq('is_active', true).order('name'),
      supabase.from('brands').select('id, name').eq('is_active', true).order('name'),
      supabase.from('products').select('id, name').eq('is_active', true).order('name'),
    ]);

  if (!coupon) notFound();

  const toOptions = (rows: Array<{ id: string; name?: string; shop_name?: string }>): Option[] =>
    (rows ?? []).map((row) => ({ id: row.id, label: row.shop_name ?? row.name ?? row.id }));

  return (
    <div className="space-y-6">
      <div>
        <Link href="/admin/coupons" className="text-sm font-semibold text-primary-600 hover:text-primary-700">
          ← All coupons
        </Link>
        <h1 className="mt-2 text-2xl font-semibold text-ink-950">
          Edit coupon <span className="font-mono">{coupon.code}</span>
        </h1>
        <p className="mt-1 text-sm text-ink-500">
          Created {formatIndiaDateTime(coupon.created_at)}. Existing usage is never reset from this form.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Card>
          <div className="p-4">
            <p className="text-xs text-ink-400">Total uses</p>
            <p className="mt-1 text-lg font-bold text-ink-900">
              {coupon.used_count}
              {coupon.usage_limit !== null ? ` / ${coupon.usage_limit}` : ''}
            </p>
          </div>
        </Card>
        <Card>
          <div className="p-4">
            <p className="text-xs text-ink-400">Uses per retailer</p>
            <p className="mt-1 text-lg font-bold text-ink-900">{coupon.per_retailer_limit}</p>
          </div>
        </Card>
        <Card>
          <div className="p-4">
            <p className="text-xs text-ink-400">Window</p>
            <p className="mt-1 text-xs font-semibold leading-5 text-ink-900">
              {formatIndiaDateTime(coupon.starts_at)} → {formatIndiaDateTime(coupon.expires_at)}
            </p>
          </div>
        </Card>
        <Card>
          <div className="p-4">
            <p className="text-xs text-ink-400">Status</p>
            <p className="mt-1 text-lg font-bold text-ink-900">{coupon.is_active ? 'Active' : 'Deactivated'}</p>
          </div>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Coupon details</CardTitle>
        </CardHeader>
        <CouponForm
          initial={{
            id: coupon.id,
            code: coupon.code,
            title: coupon.title,
            description: coupon.description ?? '',
            discountType: coupon.discount_type,
            discountValue: String(coupon.discount_value),
            minimumOrderValue: String(coupon.minimum_order_value),
            maximumDiscount: coupon.maximum_discount === null ? '' : String(coupon.maximum_discount),
            usageLimit: coupon.usage_limit === null ? '' : String(coupon.usage_limit),
            perRetailerLimit: String(coupon.per_retailer_limit),
            startsAt: coupon.starts_at.slice(0, 16),
            expiresAt: coupon.expires_at.slice(0, 16),
            isActive: coupon.is_active,
            firstOrderOnly: coupon.first_order_only,
            retailerId: coupon.retailer_id ?? '',
            categoryId: coupon.category_id ?? '',
            brandId: coupon.brand_id ?? '',
            productId: coupon.product_id ?? '',
          }}
          retailers={toOptions((retailerData ?? []) as Array<{ id: string; shop_name: string }>)}
          categories={toOptions((categoryData ?? []) as Array<{ id: string; name: string }>)}
          brands={toOptions((brandData ?? []) as Array<{ id: string; name: string }>)}
          products={toOptions((productData ?? []) as Array<{ id: string; name: string }>)}
        />
      </Card>

      {coupon.used_count === 0 ? (
        <AdminEmptyState
          icon={Ticket}
          title="Not redeemed yet"
          body="Usage starts counting the moment a retailer's order is placed with this code."
        />
      ) : null}
    </div>
  );
}
