import { createClient } from '@/lib/supabase/server';
import { requirePermission } from '@/lib/admin/guard';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { CouponForm, type Option } from '@/components/admin/coupon-form';

export default async function AdminNewCouponPage() {
  await requirePermission('pricing.manage');
  const supabase = createClient();

  const [{ data: retailerData }, { data: categoryData }, { data: brandData }, { data: productData }] = await Promise.all([
    supabase.from('retailers').select('id, shop_name').eq('status', 'active').order('shop_name'),
    supabase.from('categories').select('id, name').eq('is_active', true).order('name'),
    supabase.from('brands').select('id, name').eq('is_active', true).order('name'),
    supabase.from('products').select('id, name').eq('is_active', true).order('name'),
  ]);

  const toOptions = (rows: Array<{ id: string; name?: string; shop_name?: string }>): Option[] =>
    (rows ?? []).map((row) => ({ id: row.id, label: row.shop_name ?? row.name ?? row.id }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-ink-950">New coupon</h1>
        <p className="mt-1 text-sm text-ink-500">
          The code goes live for the moment its start time is reached. Discount and limits are enforced server-side on every order.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Coupon details</CardTitle>
        </CardHeader>
        <CouponForm
          retailers={toOptions((retailerData ?? []) as Array<{ id: string; shop_name: string }>)}
          categories={toOptions((categoryData ?? []) as Array<{ id: string; name: string }>)}
          brands={toOptions((brandData ?? []) as Array<{ id: string; name: string }>)}
          products={toOptions((productData ?? []) as Array<{ id: string; name: string }>)}
        />
      </Card>
    </div>
  );
}
