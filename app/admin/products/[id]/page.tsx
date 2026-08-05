import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { ProductForm } from '@/components/admin/product-form';
import { ProductImageManager } from '@/components/admin/product-image-manager';
import { ProductPackManager } from '@/components/admin/product-pack-manager';
import { updateProductAction } from '@/lib/admin/products-actions';

interface ProductDetail {
  id: string;
  sku_code: string;
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
  ptr: number | null;
  wholesale_price: number | null;
  barcode: string | null;
  is_active: boolean;
}

interface Option {
  id: string;
  name: string;
}

export default async function EditProductPage({ params }: { params: { id: string } }) {
  const supabase = createClient();

  const [{ data: product }, { data: brandData }, { data: categoryData }, { data: imageData }, { data: packData }] =
    await Promise.all([
      supabase
        .from('products')
        .select(
          'id, sku_code, name, brand_id, category_id, unit, units_per_case, base_price, cost_price, gst_percent, hsn_code, barcode, lead_time_days, is_new_launch'
        )
        .eq('id', params.id)
        .single<ProductDetail>(),
      supabase.from('brands').select('id, name').eq('is_active', true).order('name'),
      supabase.from('categories').select('id, name').eq('is_active', true).order('name'),
      supabase.from('product_images').select('id, image_url, sort_order').eq('product_id', params.id).order('sort_order'),
      supabase
        .from('product_packs')
        .select('id, pack_name, pack_sku_code, units_per_case, base_price, mrp, ptr, wholesale_price, barcode, is_active')
        .eq('product_id', params.id)
        .order('sort_order'),
    ]);

  if (!product) {
    notFound();
  }

  const boundUpdateAction = updateProductAction.bind(null, params.id);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-ink-950">{product!.name}</h1>
        <p className="mt-1 text-sm font-mono text-xs text-ink-500">{product!.sku_code}</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Product details</CardTitle>
        </CardHeader>
        <ProductForm
          action={boundUpdateAction}
          brands={(brandData ?? []) as Option[]}
          categories={(categoryData ?? []) as Option[]}
          defaults={product!}
          submitLabel="Save changes"
        />
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Images</CardTitle>
        </CardHeader>
        <ProductImageManager
          productId={params.id}
          skuCode={product!.sku_code}
          images={(imageData ?? []) as ProductImageRow[]}
        />
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Pack sizes</CardTitle>
        </CardHeader>
        <ProductPackManager productId={params.id} packs={(packData ?? []) as ProductPackRow[]} />
      </Card>
    </div>
  );
      }
