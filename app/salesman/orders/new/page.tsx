import { notFound } from 'next/navigation';
import { ShoppingCart } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { requireUser } from '@/lib/auth/session';
import { getProductPriceOverride, resolvePackPrice } from '@/lib/retailer/effective-price';
import { loadPackTiers } from '@/lib/retailer/pricing-data';
import { SalesmanOrderBuilder } from '@/components/salesman/order-builder';
import { Card } from '@/components/ui/card';

interface AssignedRetailer {
  id: string;
  shop_name: string;
  area_id: string;
  credit_limit: number;
  outstanding_balance: number;
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
  }[];
}

export default async function NewSalesmanOrderPage({
  searchParams,
}: {
  searchParams: { retailer?: string };
}) {
  const user = await requireUser();
  const supabase = createClient();

  const { data: retailerData } = await supabase
    .from('retailers')
    .select('id, shop_name, area_id, credit_limit, outstanding_balance, status')
    .eq('assigned_salesman_id', user.id)
    .eq('status', 'active')
    .order('shop_name')
    .returns<AssignedRetailer[]>();

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
  // The salesman's copy of the pricing rule is the canonical engine, so each
  // pack needs its own loose-piece tiers loaded from the database.
  const tierMap = await loadPackTiers(
    supabase,
    catalog.flatMap((product) => product.product_packs.map((pack) => pack.id))
  );
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

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold text-ink-950">Create Order</h1>
        <p className="mt-1 text-sm text-ink-500">Prices, GST, MOQ, and credit are rechecked when the order is submitted.</p>
      </div>
      <SalesmanOrderBuilder
        retailers={retailers.map((retailer) => ({ id: retailer.id, shopName: retailer.shop_name }))}
        selectedRetailerId={selectedRetailer.id}
        products={products}
        credit={{ limit: selectedRetailer.credit_limit, outstanding: selectedRetailer.outstanding_balance }}
      />
    </div>
  );
}
