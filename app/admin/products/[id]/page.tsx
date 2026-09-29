import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { ProductForm } from '@/components/admin/product-form';
import { ProductImageManager } from '@/components/admin/product-image-manager';
import { ProductPackManager } from '@/components/admin/product-pack-manager';
import { ProductPackStockEditor } from '@/components/admin/product-pack-stock-editor';
import type { ProductPackStockRow } from '@/components/admin/product-pack-stock-editor';
import { updateProductAction } from '@/lib/admin/products-actions';
import { loadPackCosts, loadProductCost } from '@/lib/admin/cost-access';
import { loadStockMap } from '@/lib/admin/catalog-data';

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
  hsn_code: string | null;
  barcode: string | null;
  lead_time_days: number;
  is_new_launch: boolean;
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
  /** Minimum order quantity in PIECES (0026 comment). */
  moq: number;
  /** false = this pack is sold in whole cases only. */
  allow_loose_pieces: boolean;
  is_active: boolean;
  stock_quantity: number | null;
  tiers: PackTierRow[];
  packImages: { id: string; image_url: string; sort_order: number }[];
}

interface PackTierRow {
  id: string;
  min_quantity: number;
  max_quantity: number | null;
  price_per_piece: number;
  /** 'loose' = a loose-piece slab (0026); the others are pre-feature rules. */
  rule_type: 'default' | 'case' | 'bulk' | 'loose';
  label: string | null;
}

interface Option {
  id: string;
  name: string;
}

export default async function EditProductPage({ params }: { params: { id: string } }) {
  const supabase = createClient();

  const [
    { data: productRow },
    { data: brandData },
    { data: categoryData },
    { data: imageData },
    { data: packData },
  ] = await Promise.all([
    supabase
      .from('products')
      // Purchase cost remains role-checked through its dedicated accessor.
      .select(
        'id, name, brand_id, category_id, unit, units_per_case, base_price, gst_percent, hsn_code, barcode, lead_time_days, is_new_launch'
      )
      .eq('id', params.id)
      .single<Omit<ProductDetail, 'cost_price'>>(),
    supabase.from('brands').select('id, name').eq('is_active', true).order('name'),
    supabase.from('categories').select('id, name').eq('is_active', true).order('name'),
    supabase.from('product_images').select('id, image_url, sort_order').eq('product_id', params.id).order('sort_order'),
    supabase
      .from('product_packs')
      .select(
        'id, pack_name, pack_sku_code, units_per_case, base_price, mrp, case_price, barcode, image_url, moq, allow_loose_pieces, is_active'
      )
      .eq('product_id', params.id)
      .order('sort_order')
      .order('created_at'),
  ]);

  if (!productRow) {
    notFound();
  }

  // Purchase cost is admin-only and, since migration 0025, no longer readable
  // as a plain column by any session (direct SELECT is revoked from
  // anon/authenticated). It is fetched through the SECURITY DEFINER accessors,
  // which re-check is_admin_or_above() inside the database.
  const [productCost, packCosts, packStock] = await Promise.all([
    loadProductCost(supabase, params.id),
    loadPackCosts(supabase, params.id),
    loadStockMap(supabase, [params.id], true),
  ]);
  const product: ProductDetail | null = productRow
    ? { ...(productRow as Omit<ProductDetail, 'cost_price'>), cost_price: productCost }
    : null;

  const rawPacks = ((packData ?? []) as unknown as Omit<ProductPackRow, 'tiers' | 'cost_price' | 'packImages' | 'stock_quantity'>[]).map(
    (pack) => ({
      ...pack,
      cost_price: packCosts.get(pack.id) ?? null,
      stock_quantity: packStock.get(pack.id) ?? null,
    })
  ) as Omit<ProductPackRow, 'tiers' | 'packImages'>[];
  const packIds = rawPacks.map((pack) => pack.id);
  const [{ data: tierData }, { data: packImageData }] =
    packIds.length > 0
      ? await Promise.all([
          supabase
            .from('product_pricing_tiers')
            .select('id, product_pack_id, min_quantity, max_quantity, price_per_piece, rule_type, label')
            .in('product_pack_id', packIds)
            .eq('is_active', true)
            .order('min_quantity'),
          supabase
            .from('product_pack_images')
            .select('id, product_pack_id, image_url, sort_order')
            .in('product_pack_id', packIds)
            .order('sort_order'),
        ])
      : ([{ data: null }, { data: null }] as unknown as [{ data: null }, { data: null }]);

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

  const packImagesByPack = new Map<string, { id: string; image_url: string; sort_order: number }[]>();
  for (const row of (packImageData ?? []) as unknown as { id: string; product_pack_id: string; image_url: string; sort_order: number }[]) {
    const list = packImagesByPack.get(row.product_pack_id) ?? [];
    list.push({ id: row.id, image_url: row.image_url, sort_order: row.sort_order });
    packImagesByPack.set(row.product_pack_id, list);
  }

  const packs = rawPacks.map((pack) => ({
    ...pack,
    tiers: tiersByPack.get(pack.id) ?? [],
    packImages: [...(packImagesByPack.get(pack.id) ?? [])].sort((a, b) => a.sort_order - b.sort_order),
  })) as ProductPackRow[];

  // Case selling price for the product form defaults = the auto-seeded default
  // pack's case price. That pack is the first one by sort order, matching how
  // updateProductAction resolves it server-side.
  const defaultPack = packs[0];
  const productCasePrice = defaultPack?.case_price ?? null;
  // MOQ lives on product_packs (0007), so the form seeds from the same default
  // pack updateProductAction keeps in sync — never from an invented default.
  const productMoq = defaultPack?.moq ?? null;
  const stockEditorPacks: ProductPackStockRow[] = packs.map((pack) => ({
    id: pack.id,
    packName: pack.pack_name,
    skuCode: pack.pack_sku_code,
    active: pack.is_active,
    casePrice: Number(pack.case_price),
    mrp: pack.mrp === null ? null : Number(pack.mrp),
    unitsPerCase: pack.units_per_case,
    quantity: pack.stock_quantity,
  }));

  const boundUpdateAction = updateProductAction.bind(null, params.id);


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
          defaults={{ ...product!, case_price: productCasePrice, moq: productMoq }}
          submitLabel="Save changes"
        />
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Pack stock</CardTitle>
        </CardHeader>
        <ProductPackStockEditor
          packs={stockEditorPacks}
          unit={product!.unit}
        />
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
        <ProductPackManager productId={params.id} packs={packs} gstPercent={product?.gst_percent ?? 0} />
      </Card>
    </div>
  );
}
