import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { requirePermission } from '@/lib/admin/guard';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { InventoryNav } from '@/components/admin/inventory-nav';
import { GrnForm } from '@/components/admin/grn-form';

export default async function NewGrnPage() {
  await requirePermission('inventory.view');
  const supabase = createClient();

  const [{ data: productData }, { data: warehouseData }] = await Promise.all([
    supabase.from('products').select('id, name, sku_code').eq('is_active', true).order('name'),
    supabase.from('warehouses').select('id, name').eq('is_active', true).order('name'),
  ]);

  const products = (productData ?? []) as { id: string; name: string; sku_code: string | null }[];
  const warehouses = (warehouseData ?? []) as { id: string; name: string }[];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-ink-950">New Goods Received Note</h1>
        <p className="mt-1 text-sm text-ink-500">
          Record incoming stock with batch numbers, manufacturing and expiry dates. Confirmation is a separate,
          atomic step — <Link href="/admin/inventory/grn" className="text-primary-600 hover:underline">view all GRNs</Link>.
        </p>
      </div>

      <InventoryNav />

      <Card>
        <CardHeader>
          <CardTitle>GRN details</CardTitle>
        </CardHeader>
        <GrnForm products={products} warehouses={warehouses} />
      </Card>
    </div>
  );
}
