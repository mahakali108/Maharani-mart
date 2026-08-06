import { notFound } from 'next/navigation';
import Image from 'next/image';
import { ImageOff } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { requireUser } from '@/lib/auth/session';
import { getProductPriceOverride, resolvePackPrice } from '@/lib/retailer/effective-price';
import { Card } from '@/components/ui/card';
import { PackSelector } from '@/components/retailer/pack-selector';

interface ProductDetailRow {
  id: string;
  name: string;
  sku_code: string;
  gst_percent: number;
  is_new_launch: boolean;
  brands: { name: string } | null;
  categories: { name: string } | null;
  product_images: { id: string; image_url: string; sort_order: number }[];
}

interface PackRow {
  id: string;
  pack_name: string;
  pack_sku_code: string;
  units_per_case: number;
  base_price: number;
  ptr: number | null;
  mrp: number | null;
  moq: number;
}

export default async function ProductDetailPage({ params }: { params: { id: string } }) {
  const user = await requireUser();
  const supabase = createClient();

  const { data: retailer } = await supabase
    .from('retailers')
    .select('area_id')
    .eq('id', user.id)
    .maybeSingle<{ area_id: string }>();

  const [{ data: product }, { data: packData }] = await Promise.all([
    supabase
      .from('products')
      .select('id, name, sku_code, gst_percent, is_new_launch, brands ( name ), categories ( name ), product_images ( id, image_url, sort_order )')
      .eq('id', params.id)
      .eq('is_active', true)
      .maybeSingle<ProductDetailRow>(),
    supabase
      .from('product_packs')
      .select('id, pack_name, pack_sku_code, units_per_case, base_price, ptr, mrp, moq')
      .eq('product_id', params.id)
      .eq('is_active', true)
      .order('sort_order')
      .returns<PackRow[]>(),
  ]);

  if (!product) notFound();

  const override = await getProductPriceOverride(supabase, params.id, user.id, retailer?.area_id ?? null);
  const packs = (packData ?? []).map((pack) => ({
    ...pack,
    effectivePrice: resolvePackPrice(pack, override),
  }));

  const images = [...product.product_images].sort((a, b) => a.sort_order - b.sort_order);

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <div className="space-y-2">
          <div className="relative aspect-square overflow-hidden rounded-2xl bg-ink-50">
            {images[0] ? (
              <Image src={images[0].image_url} alt={product.name} fill className="object-cover" unoptimized />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-ink-300">
                <ImageOff className="h-12 w-12" />
              </div>
            )}
          </div>
          {images.length > 1 ? (
            <div className="flex gap-2 overflow-x-auto">
              {images.map((img) => (
                <div key={img.id} className="relative h-16 w-16 shrink-0 overflow-hidden rounded-lg bg-ink-50">
                  <Image src={img.image_url} alt="" fill className="object-cover" unoptimized />
                </div>
              ))}
            </div>
          ) : null}
        </div>

        <div className="space-y-3">
          {product.brands?.name ? <p className="text-sm text-ink-400">{product.brands.name}</p> : null}
          <h1 className="text-xl font-semibold text-ink-950">
            {product.name}
            {product.is_new_launch ? (
              <span className="ml-2 rounded-full bg-primary-50 px-2 py-0.5 align-middle text-[10px] font-semibold uppercase text-primary-600">
                New
              </span>
            ) : null}
          </h1>
          <p className="font-mono text-xs text-ink-400">{product.sku_code}</p>
          {product.categories?.name ? (
            <p className="text-xs text-ink-500">Category: {product.categories.name}</p>
          ) : null}
          <p className="text-xs text-ink-500">GST: {product.gst_percent}%</p>
        </div>
      </div>

      {packs.length === 0 ? (
        <Card>
          <p className="text-sm text-ink-500">No pack sizes are available for this product yet.</p>
        </Card>
      ) : (
        <PackSelector packs={packs} gstPercent={product.gst_percent} />
      )}
    </div>
  );
}
