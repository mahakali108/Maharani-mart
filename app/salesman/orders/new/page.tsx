import { notFound } from 'next/navigation';
import { ShoppingCart } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { throwIfReadFailed } from '@/lib/supabase/read-guard';
import { requireUser } from '@/lib/auth/session';
import { getProductPriceOverride, resolvePackPrice } from '@/lib/retailer/effective-price';
import { loadPackTiers } from '@/lib/retailer/pricing-data';
import { getRetailerCoinPosition } from '@/lib/coins/server';
import { loadCatalogAvailability } from '@/lib/retailer/catalog';
import { SalesmanOrderBuilder } from '@/components/salesman/order-builder';
import { Card } from '@/components/ui/card';

interface AssignedRetailer {
  id: string;
  shop_name: string;
  area_id: string;
  status: 'pending_approval' | 'active' | 'suspended';
}

interface CatalogProduct {
  id: string;
  name: string;
  gst_percent: number;
  brands: { name: string } | null;
  product_images: { image_url: string; sort_order: number }[];
  product_packs: {
    id: string;
    pack_name: string;
    pack_sku_code: string;
    base_price: number;
    ptr: number | null;
    case_price: number;
    units_per_case: number;
    /** Minimum order quantity in PIECES. */
    moq: number;
    /** false = this pack may only be sold in whole cases. */
    allow_loose_pieces: boolean;
    is_active: boolean;
    sort_order: number;
    availability?: 'in_stock' | 'out_of_stock' | 'unknown';
  }[];
}

export default async function NewSalesmanOrderPage({
  searchParams,
}: {
  searchParams: { retailer?: string };
}) {
  const user = await requireUser();
  const supabase = createClient();

  const { data: retailerData, error: retailerError } = await supabase
    .from('retailers')
    .select('id, shop_name, area_id, status')
    .eq('assigned_salesman_id', user.id)
    .eq('status', 'active')
    .order('shop_name')
    .returns<AssignedRetailer[]>();

  // Without this the failure rendered as "No active retailers assigned" — a
  // statement about the salesman's book of business that was simply untrue.
  throwIfReadFailed(retailerError, 'Assigned retailers');
  const retailers = retailerData ?? [];
  if (retailers.length === 0) {
    return (
      <div className="space-y-5">
        <div>
          <h1 className="text-xl font-semibold text-ink-950">Create Order</h1>
          <p className="mt-1 text-sm text-ink-500">Capture an order for an assigned retailer.</p>
        </div>
        <Card className="flex flex-col items-center gap-2 py-12 text-center">
          <ShoppingCart className="h-8 w-8 text-ink-300" />
          <p className="font-medium text-ink-700">No active retailers assigned</p>
          <p className="max-w-sm text-sm text-ink-400">An admin must assign an active retailer to you before you can create an order.</p>
        </Card>
      </div>
    );
  }

  const selectedRetailer = searchParams.retailer
    ? retailers.find((retailer) => retailer.id === searchParams.retailer)
    : retailers[0];

  // An unassigned UUID in the URL is rejected rather than silently
  // switching to another retailer. RLS independently enforces this too.
  if (!selectedRetailer) notFound();

  const { data: productData } = await supabase
    .from('products')
    .select(
      'id, name, gst_percent, brands ( name ), product_images ( image_url, sort_order ), product_packs ( id, pack_name, pack_sku_code, base_price, ptr, case_price, units_per_case, moq, allow_loose_pieces, is_active, sort_order )'
    )
    .eq('is_active', true)
    .order('name')
    .returns<CatalogProduct[]>();

  const catalog = productData ?? [];
  const activePackIds = catalog.flatMap((product) => product.product_packs.filter((pack) => pack.is_active).map((pack) => pack.id));
  // Pricing and exact-pack availability both come from server-side reads.
  const [tierMap, availabilityByPack] = await Promise.all([
    // Price the catalogue for the retailer this order is being placed for.
    loadPackTiers(supabase, activePackIds, selectedRetailer.id),
    loadCatalogAvailability(supabase, activePackIds),
  ]);
  const overrides = await Promise.all(
    catalog.map((product) =>
      getProductPriceOverride(supabase, product.id, selectedRetailer.id, selectedRetailer.area_id)
    )
  );

  const products = catalog
    .map((product, index) => {
      const image = [...product.product_images].sort((a, b) => a.sort_order - b.sort_order)[0];
      const packs = product.product_packs
        .filter((pack) => pack.is_active)
        .sort((a, b) => a.sort_order - b.sort_order)
        .map((pack) => ({
          id: pack.id,
          name: pack.pack_name,
          skuCode: pack.pack_sku_code,
          moq: pack.moq,
          unitsPerCase: pack.units_per_case,
          allowLoosePieces: pack.allow_loose_pieces !== false,
          availability: availabilityByPack.get(pack.id)?.state ?? 'unknown',
          tiers: tierMap.get(pack.id) ?? [],
          effectivePrice: resolvePackPrice(pack, overrides[index] ?? null),
        }));

      return {
        id: product.id,
        name: product.name,
        brandName: product.brands?.name ?? null,
        imageUrl: image?.image_url ?? null,
        gstPercent: product.gst_percent,
        packs,
      };
    })
    .filter((product) => product.packs.length > 0);

  // 🪙 The shop's coin balance, read server-side. Salesman capture has no
  // credit control: coins are the balance, and the server recomputes them.
  const coinPosition = await getRetailerCoinPosition(supabase, selectedRetailer.id);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold text-ink-950">Create Order</h1>
        <p className="mt-1 text-sm text-ink-500">Prices, GST, MOQ and coins are rechecked when the order is submitted.</p>
      </div>
      <SalesmanOrderBuilder
        retailers={retailers.map((retailer) => ({ id: retailer.id, shopName: retailer.shop_name }))}
        selectedRetailerId={selectedRetailer.id}
        products={products}
        coinsAvailableRupees={coinPosition.balanceRupees}
      />
    </div>
  );
}
