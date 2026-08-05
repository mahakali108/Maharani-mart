import { Tag, History } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { AdminEmptyState } from '@/components/admin/empty-state';
import { PriceListForm } from '@/components/admin/price-list-form';
import { PricePreviewForm } from '@/components/admin/price-preview-form';
import { DeactivatePriceButton } from '@/components/admin/deactivate-price-button';

interface ProductOption {
  id: string;
  name: string;
}

interface AreaOption {
  id: string;
  name: string;
}

interface RetailerOption {
  id: string;
  shop_name: string;
}

interface PriceListRow {
  id: string;
  scope: 'base' | 'area' | 'retailer' | 'scheme' | 'festival';
  price: number;
  priority: number;
  is_active: boolean;
  created_at: string;
  products: { name: string; sku_code: string } | null;
  areas: { name: string } | null;
  retailers: { shop_name: string } | null;
}

const SCOPE_LABELS: Record<PriceListRow['scope'], string> = {
  base: 'Base',
  area: 'Area',
  retailer: 'Retailer',
  scheme: 'Scheme',
  festival: 'Festival',
};

export default async function PricingPage() {
  const supabase = createClient();

  const [{ data: productData }, { data: areaData }, { data: retailerData }, { data: priceListData }] =
    await Promise.all([
      supabase.from('products').select('id, name').eq('is_active', true).order('name'),
      supabase.from('areas').select('id, name').eq('is_active', true).order('name'),
      supabase.from('retailers').select('id, shop_name').eq('status', 'active').order('shop_name'),
      supabase
        .from('price_lists')
        .select(
          'id, scope, price, priority, is_active, created_at, products ( name, sku_code ), areas ( name ), retailers ( shop_name )'
        )
        .in('scope', ['base', 'area', 'retailer'])
        .order('created_at', { ascending: false })
        .limit(100),
    ]);

  const products = (productData ?? []) as ProductOption[];
  const areas = (areaData ?? []) as AreaOption[];
  const retailers = (retailerData ?? []) as RetailerOption[];
  const priceLists = (priceListData ?? []) as unknown as PriceListRow[];

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold text-ink-950">Pricing &amp; Schemes</h1>
        <p className="mt-1 text-sm text-ink-500">
          Set base, area-specific, and retailer-specific prices. The pricing engine picks the highest-priority
          matching price automatically at order time.
        </p>
      </div>

      {products.length === 0 ? (
        <AdminEmptyState
          icon={Tag}
          title="No active products yet"
          body="Add products in the Products section before setting up pricing."
        />
      ) : (
        <>
          <Card>
            <CardHeader>
              <CardTitle>Add a price</CardTitle>
            </CardHeader>
            <PriceListForm products={products} areas={areas} retailers={retailers} />
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Preview effective price</CardTitle>
            </CardHeader>
            <p className="mb-4 text-sm text-ink-500">
              Check exactly what a specific retailer would be charged for a product right now, factoring in every
              price tier that applies to them.
            </p>
            <PricePreviewForm products={products} retailers={retailers} />
          </Card>
        </>
      )}

      <div>
        <div className="mb-3 flex items-center gap-2">
          <History className="h-4 w-4 text-primary-600" />
          <h2 className="text-sm font-semibold text-ink-800">Price history</h2>
        </div>

        {priceLists.length === 0 ? (
          <AdminEmptyState
            icon={History}
            title="No prices set yet"
            body="Every price you add above — active or later deactivated — will be listed here as a full history."
          />
        ) : (
          <Card className="overflow-hidden p-0">
            <table className="w-full text-sm">
              <thead className="border-b border-ink-100 bg-ink-50 text-left text-xs uppercase tracking-wide text-ink-500">
                <tr>
                  <th className="px-5 py-3 font-medium">Product</th>
                  <th className="px-5 py-3 font-medium">Scope</th>
                  <th className="px-5 py-3 font-medium">Applies to</th>
                  <th className="px-5 py-3 font-medium">Price</th>
                  <th className="px-5 py-3 font-medium">Priority</th>
                  <th className="px-5 py-3 font-medium">Set on</th>
                  <th className="px-5 py-3 font-medium">Status</th>
                  <th className="px-5 py-3 font-medium" />
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100">
                {priceLists.map((pl) => (
                  <tr key={pl.id} className={pl.is_active ? '' : 'opacity-50'}>
                    <td className="px-5 py-3">
                      <p className="font-medium text-ink-900">{pl.products?.name ?? '—'}</p>
                      <p className="font-mono text-xs text-ink-400">{pl.products?.sku_code}</p>
                    </td>
                    <td className="px-5 py-3 text-ink-600">{SCOPE_LABELS[pl.scope]}</td>
                    <td className="px-5 py-3 text-ink-600">
                      {pl.scope === 'area' ? pl.areas?.name ?? '—' : pl.scope === 'retailer' ? pl.retailers?.shop_name ?? '—' : '— Everyone —'}
                    </td>
                    <td className="px-5 py-3 font-semibold text-ink-900">₹{pl.price.toFixed(2)}</td>
                    <td className="px-5 py-3 text-ink-600">{pl.priority}</td>
                    <td className="px-5 py-3 text-ink-500">{new Date(pl.created_at).toLocaleDateString('en-IN')}</td>
                    <td className="px-5 py-3">
                      <span
                        className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                          pl.is_active ? 'bg-green-50 text-green-700' : 'bg-ink-100 text-ink-500'
                        }`}
                      >
                        {pl.is_active ? 'Active' : 'Deactivated'}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-right">
                      {pl.is_active ? <DeactivatePriceButton priceListId={pl.id} /> : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        )}
      </div>
    </div>
  );
                    }
