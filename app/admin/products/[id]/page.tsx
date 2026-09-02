import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { ProductForm } from '@/components/admin/product-form';
import { ProductImageManager } from '@/components/admin/product-image-manager';
import { ProductPackManager } from '@/components/admin/product-pack-manager';
import { ProductThresholdsForm } from '@/components/admin/product-thresholds-form';
import { updateProductAction } from '@/lib/admin/products-actions';
import { loadPackCosts, loadProductCost } from '@/lib/admin/cost-access';

interface ProductDetail {
  id: string;
  name: string;
  brand_id: string | null;
  category_id: string | null;
  unit: string;
  units_per_case: number;
  base_price: number;
  cost_price: number | null;
  gst_percent: number;
  barcode: string | null;
  lead_time_days: number;
  is_new_launch: boolean;
  min_stock: number;
  reorder_level: number;
  max_stock: number;
}

interface ProductImageRow {
  id: string;
  image_url: string;
  sort_order: number;
}

interface ProductPackRow {
  id: string;
  pack_name: string;
  pack_sku_code: string;
  units_per_case: number;
  base_price: number;
  mrp: number | null;
  cost_price: number | null;
  case_price: number;
  barcode: string | null;
  image_url: string | null;
  is_active: boolean;
  tiers: PackTierRow[];
}

interface PackTierRow {
  id: string;
  min_quantity: number;
  max_quantity: number | null;
  price_per_piece: number;
  rule_type: 'default' | 'case' | 'bulk';
  label: string | null;
}

interface Option {
  id: string;
  name: string;
}

interface WarehouseStockRow {
  warehouse_id: string;
  quantity: number;
  reserved_quantity: number;
  warehouses: { name: string } | null;
}

interface ProductBatchRow {
  id: string;
  batch_number: string;
  expiry_date: string | null;
  current_quantity: number;
  reserved_quantity: number;
  warehouses: { name: string } | null;
}

interface ProductMovementRow {
  id: string;
  movement_type: string;
  quantity: number;
  direction: string | null;
  created_at: string;
  warehouses: { name: string } | null;
}

export default async function EditProductPage({ params }: { params: { id: string } }) {
  const supabase = createClient();

  const [
    { data: productRow },
    { data: brandData },
    { data: categoryData },
    { data: imageData },
    { data: packData },
    { data: stockData },
    { data: batchData },
    { data: movementData },
  ] = await Promise.all([
    supabase
      .from('products')
      // `cost_price` is deliberately NOT selected: migration 0025 revokes
      // direct column SELECT from anon/authenticated so a retailer session can
      // never read purchase cost via PostgREST. Admin reads it through the
      // SECURITY DEFINER accessor below (loadProductCost / loadPackCosts).
      .select(
        'id, name, brand_id, category_id, unit, units_per_case, base_price, gst_percent, barcode, lead_time_days, is_new_launch, min_stock, reorder_level, max_stock'
      )
      .eq('id', params.id)
      .single<Omit<ProductDetail, 'cost_price'>>(),
    supabase.from('brands').select('id, name').eq('is_active', true).order('name'),
    supabase.from('categories').select('id, name').eq('is_active', true).order('name'),
    supabase.from('product_images').select('id, image_url, sort_order').eq('product_id', params.id).order('sort_order'),
    supabase
      .from('product_packs')
      .select('id, pack_name, pack_sku_code, units_per_case, base_price, mrp, case_price, barcode, image_url, is_active')
      .eq('product_id', params.id)
      .order('sort_order')
      .order('created_at'),
    supabase
      .from('inventory_stock')
      .select('warehouse_id, quantity, reserved_quantity, warehouses ( name )')
      .eq('product_id', params.id),
    supabase
      .from('inventory_batches')
      .select('id, batch_number, expiry_date, current_quantity, reserved_quantity, warehouses ( name )')
      .eq('product_id', params.id)
      .gt('current_quantity', 0)
      .order('expiry_date', { ascending: true, nullsFirst: false }),
    supabase
      .from('stock_movements')
      .select('id, movement_type, quantity, direction, created_at, warehouses ( name )')
      .eq('product_id', params.id)
      .order('seq', { ascending: false })
      .limit(8),
  ]);

  if (!productRow) {
    notFound();
  }

  // Purchase cost is admin-only and, since migration 0025, no longer readable
  // as a plain column by any session (direct SELECT is revoked from
  // anon/authenticated). It is fetched through the SECURITY DEFINER accessors,
  // which re-check is_admin_or_above() inside the database.
  const [productCost, packCosts] = await Promise.all([
    loadProductCost(supabase, params.id),
    loadPackCosts(supabase, params.id),
  ]);
  const product: ProductDetail | null = productRow
    ? { ...(productRow as Omit<ProductDetail, 'cost_price'>), cost_price: productCost }
    : null;

  const rawPacks = ((packData ?? []) as unknown as Omit<ProductPackRow, 'tiers' | 'cost_price'>[]).map(
    (pack) => ({ ...pack, cost_price: packCosts.get(pack.id) ?? null })
  ) as Omit<ProductPackRow, 'tiers'>[];
  const packIds = rawPacks.map((pack) => pack.id);
  const { data: tierData } =
    packIds.length > 0
      ? await supabase
          .from('product_pricing_tiers')
          .select('id, product_pack_id, min_quantity, max_quantity, price_per_piece, rule_type, label')
          .in('product_pack_id', packIds)
          .eq('is_active', true)
          .order('min_quantity')
      : ({ data: null } as { data: null });

  const tiersByPack = new Map<string, PackTierRow[]>();
  for (const row of (tierData ?? []) as (PackTierRow & { product_pack_id: string })[]) {
    const list = tiersByPack.get(row.product_pack_id) ?? [];
    list.push({
      id: row.id,
      min_quantity: row.min_quantity,
      max_quantity: row.max_quantity,
      price_per_piece: row.price_per_piece,
      rule_type: row.rule_type,
      label: row.label,
    });
    tiersByPack.set(row.product_pack_id, list);
  }

  const packs = rawPacks.map((pack) => ({ ...pack, tiers: tiersByPack.get(pack.id) ?? [] })) as ProductPackRow[];

  // Case selling price for the product form defaults = the auto-seeded default
  // pack's case price. That pack is the first one by sort order, matching how
  // updateProductAction resolves it server-side.
  const defaultPack = packs[0];
  const productCasePrice = defaultPack?.case_price ?? null;

  const boundUpdateAction = updateProductAction.bind(null, params.id);

  const stock = (stockData ?? []) as unknown as WarehouseStockRow[];
  const batches = (batchData ?? []) as unknown as ProductBatchRow[];
  const movements = (movementData ?? []) as unknown as ProductMovementRow[];
  const totalOnHand = stock.reduce((sum, s) => sum + s.quantity, 0);
  const totalReserved = stock.reduce((sum, s) => sum + s.reserved_quantity, 0);
  const totalAvailable = totalOnHand - totalReserved;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-ink-950">{product!.name}</h1>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Product details</CardTitle>
        </CardHeader>
        <ProductForm
          action={boundUpdateAction}
          brands={(brandData ?? []) as Option[]}
          categories={(categoryData ?? []) as Option[]}
          defaults={{ ...product!, case_price: productCasePrice }}
          submitLabel="Save changes"
        />
      </Card>

      {/* ================= INVENTORY (batch + expiry + FEFO) ================= */}
      <Card>
        <CardHeader>
          <CardTitle>Current stock</CardTitle>
          <Link href="/admin/inventory" className="text-xs font-medium text-primary-600 hover:text-primary-700">
            Inventory overview →
          </Link>
        </CardHeader>

        <div className="mb-4 grid grid-cols-3 gap-3">
          <div className="rounded-xl bg-ink-50 p-3">
            <p className="text-xs text-ink-500">Current stock</p>
            <p className="mt-1 text-xl font-semibold text-ink-950">{totalOnHand}</p>
          </div>
          <div className="rounded-xl bg-ink-50 p-3">
            <p className="text-xs text-ink-500">Reserved</p>
            <p className="mt-1 text-xl font-semibold text-ink-950">{totalReserved}</p>
          </div>
          <div className="rounded-xl bg-ink-50 p-3">
            <p className="text-xs text-ink-500">Available</p>
            <p className={`mt-1 text-xl font-semibold ${totalAvailable <= 0 ? 'text-primary-600' : 'text-green-600'}`}>
              {totalAvailable}
            </p>
          </div>
        </div>

        <div className="mb-5">
          <ProductThresholdsForm
            productId={product!.id}
            minStock={product!.min_stock}
            reorderLevel={product!.reorder_level}
            maxStock={product!.max_stock}
          />
          <p className="mt-1 text-xs text-ink-400">
            Reorder thresholds drive LOW STOCK / OUT OF STOCK alerts. 0 = not configured.
          </p>
        </div>

        {stock.length > 0 ? (
          <div className="mb-5">
            <h4 className="mb-2 text-sm font-semibold text-ink-800">Warehouse stock</h4>
            <ul className="divide-y divide-ink-100 rounded-xl border border-ink-100">
              {stock.map((s) => (
                <li key={s.warehouse_id} className="flex items-center justify-between px-4 py-2.5 text-sm">
                  <span className="font-medium text-ink-900">{s.warehouses?.name ?? '—'}</span>
                  <span className="text-ink-600">
                    {s.quantity} on hand · {s.reserved_quantity} reserved ·{' '}
                    <span className="font-semibold text-ink-900">{s.quantity - s.reserved_quantity} available</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {batches.length > 0 ? (
          <div className="mb-5">
            <h4 className="mb-2 text-sm font-semibold text-ink-800">
              Batches <span className="font-normal text-ink-400">(FEFO order — earliest expiry allocated first)</span>
            </h4>
            <ul className="divide-y divide-ink-100 rounded-xl border border-ink-100">
              {batches.map((b, idx) => {
                const daysLeft = b.expiry_date
                  ? Math.ceil((new Date(b.expiry_date).getTime() - Date.now()) / 86400000)
                  : null;
                return (
                  <li key={b.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-sm">
                    <span>
                      <span className="mr-2 rounded bg-ink-100 px-1.5 py-0.5 font-mono text-xs text-ink-500">#{idx + 1}</span>
                      <span className="font-mono font-medium text-ink-900">{b.batch_number}</span>
                      <span className="ml-2 text-xs text-ink-400">{b.warehouses?.name}</span>
                    </span>
                    <span className="text-ink-600">
                      {b.current_quantity - b.reserved_quantity} available
                      {b.expiry_date ? (
                        <span className={daysLeft !== null && daysLeft < 0 ? 'ml-2 font-semibold text-primary-600' : daysLeft !== null && daysLeft <= 7 ? 'ml-2 font-semibold text-orange-600' : 'ml-2'}>
                          {daysLeft !== null && daysLeft < 0 ? `expired ${-daysLeft}d ago` : `exp ${b.expiry_date}`}
                        </span>
                      ) : (
                        <span className="ml-2 text-xs text-ink-400">no expiry</span>
                      )}
                    </span>
                  </li>
                );
              })}
            </ul>
            <p className="mt-1 text-xs text-ink-400">
              Orders automatically allocate from the earliest-expiry batch (FEFO) server-side; expired batches are
              never allocated.
            </p>
          </div>
        ) : null}

        {movements.length > 0 ? (
          <div>
            <h4 className="mb-2 text-sm font-semibold text-ink-800">Recent movements</h4>
            <ul className="divide-y divide-ink-100 rounded-xl border border-ink-100">
              {movements.map((m) => (
                <li key={m.id} className="flex items-center justify-between px-4 py-2 text-sm">
                  <span className="text-ink-600">
                    {m.movement_type.replace(/_/g, ' ')} · {m.warehouses?.name ?? '—'}
                  </span>
                  <span>
                    <span className={`mr-2 font-semibold ${m.direction === 'out' ? 'text-primary-600' : 'text-green-600'}`}>
                      {m.direction === 'out' ? '−' : '+'}{Math.abs(m.quantity)}
                    </span>
                    <span className="text-xs text-ink-400">{new Date(m.created_at).toLocaleString('en-IN')}</span>
                  </span>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-xs">
              <Link href="/admin/inventory/movements" className="text-primary-600 hover:underline">
                Full movement ledger →
              </Link>
            </p>
          </div>
        ) : null}
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Images</CardTitle>
        </CardHeader>
        <ProductImageManager productId={params.id} images={(imageData ?? []) as ProductImageRow[]} />
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Pack sizes &amp; case pricing</CardTitle>
        </CardHeader>
        <ProductPackManager productId={params.id} packs={packs} />
      </Card>
    </div>
  );
}
