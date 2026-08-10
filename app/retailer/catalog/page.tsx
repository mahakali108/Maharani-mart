import { Package } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { requireUser } from '@/lib/auth/session';
import { getProductPriceOverride, resolvePackPrice } from '@/lib/retailer/effective-price';
import { Input } from '@/components/ui/input';
import { AdminEmptyState } from '@/components/admin/empty-state';
import { ProductCard } from '@/components/retailer/product-card';

interface ProductListRow {
  id: string;
  name: string;
  sku_code: string;
  is_new_launch: boolean;
  brands: { name: string } | null;
  product_images: { image_url: string; sort_order: number }[];
  product_packs: { ptr: number | null; base_price: number; is_active: boolean }[];
}

export default async function RetailerCatalogPage({ searchParams }: { searchParams: { q?: string } }) {
  const user = await requireUser();
  const supabase = createClient();
  const q = searchParams.q?.trim() ?? '';

  const { data: retailer } = await supabase
    .from('retailers')
    .select('area_id')
    .eq('id', user.id)
    .maybeSingle<{ area_id: string }>();

  // Same embedded-select pattern already used successfully for
  // products elsewhere (app/admin/products/page.tsx, the retailer
  // product-detail page) — brand_id/product_id here are regular
  // nullable foreign keys, not the shared-primary-key case that broke
  // the retailers list, so this embed is safe.
  let query = supabase
    .from('products')
    .select(
      'id, name, sku_code, is_new_launch, brands ( name ), product_images ( image_url, sort_order ), product_packs ( ptr, base_price, is_active )'
    )
    .eq('is_active', true)
    .order('name');

  if (q) {
    query = query.or(`name.ilike.%${q}%,sku_code.ilike.%${q}%`);
  }

  const { data: productRows } = await query.returns<ProductListRow[]>();
  const products = productRows ?? [];

  // Reuses the exact same single-product pricing rule the product
  // detail, cart, and checkout pages already call — this file
  // deliberately does not add a second pricing implementation.
  const overrides = await Promise.all(
    products.map((p) => getProductPriceOverride(supabase, p.id, user.id, retailer?.area_id ?? null))
  );

  const cards = products.map((product, i) => {
    const activePacks = product.product_packs.filter((pack) => pack.is_active);
    const prices = activePacks.map((pack) => resolvePackPrice(pack, overrides[i] ?? null));
    const fromPrice = prices.length > 0 ? Math.min(...prices) : null;
    const sortedImages = [...product.product_images].sort((a, b) => a.sort_order - b.sort_order);

    return {
      id: product.id,
      name: product.name,
      brandName: product.brands?.name,
      imageUrl: sortedImages[0]?.image_url,
      isNewLaunch: product.is_new_launch,
      fromPrice,
    };
  });

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold text-ink-950">Catalog</h1>
        <p className="mt-1 text-sm text-ink-500">Browse products available for your shop.</p>
      </div>

      <form method="get">
        <Input name="q" defaultValue={q} placeholder="Search by product name or SKU" />
      </form>

      {cards.length === 0 ? (
        <AdminEmptyState
          icon={Package}
          title={q ? 'No products match your search' : 'No products available yet'}
          body={
            q
              ? 'Try a different search term.'
              : 'Your distributor is setting up the product catalog. Check back shortly.'
          }
        />
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {cards.map((card) => (
            <ProductCard key={card.id} {...card} />
          ))}
        </div>
      )}
    </div>
  );
}
