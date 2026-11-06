import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { requirePagePermission } from '@/lib/admin/guard';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { InventoryNav } from '@/components/admin/inventory-nav';
import { GrnForm } from '@/components/admin/grn-form';
import { resolveActiveWarehouse } from '@/lib/warehouse/resolver';

export default async function NewGrnPage() {
  await requirePagePermission('inventory.view');
  const supabase = (await createClient());

  const [{ data: productData }, warehouseResolution] = await Promise.all([
    supabase.from('products').select('id, name, sku_code').eq('is_active', true).order('name'),
    // ONE active warehouse: resolved centrally, never chosen by the client.
    resolveActiveWarehouse(supabase),
  ]);

  const products = (productData ?? []) as { id: string; name: string; sku_code: string }[];

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
        <GrnForm
          products={products}
          warehouse={warehouseResolution.ok ? { name: warehouseResolution.warehouse.name } : null}
          warehouseError={warehouseResolution.ok ? null : warehouseResolution.message}
        />
      </Card>
    </div>
  );
}
