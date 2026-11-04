import { IndianRupee, ShieldCheck } from 'lucide-react';
import { requirePagePermission } from '@/lib/admin/guard';
import { createClient } from '@/lib/supabase/server';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { ReadFailureNotice } from '@/components/ui/read-failure-notice';
import { normalizeRetailerCategory, type RetailerCategory } from '@/lib/pricing/category-pricing';
import { CategoryPriceEditor } from '@/components/admin/category-price-editor';

export const dynamic = 'force-dynamic';

interface PackRow {
  id: string;
  pack_name: string;
  product_id: string;
  products: { name: string; is_active: boolean } | null;
}

interface CategoryPriceRow {
  id: string;
  product_pack_id: string;
  retailer_category: string;
  price_per_piece: number;
}

export default async function CategoryTierPricingPage() {
  await requirePagePermission('pricing.manage');
  const supabase = (await createClient());

  const [packResult, priceResult, tierResult] = await Promise.all([
    supabase
      .from('product_packs')
      .select('id, pack_name, product_id, products ( name, is_active )')
      .eq('is_active', true)
      .order('product_id')
      .limit(200)
      .returns<PackRow[]>(),
    supabase
      .from('product_tier_prices' as never)
      .select('id, product_pack_id, retailer_category, price_per_piece')
      .eq('is_active', true)
      .limit(2000)
      .returns<CategoryPriceRow[]>(),
    supabase
      .from('product_pricing_tiers')
      .select('product_pack_id, min_quantity, price_per_piece')
      .eq('is_active', true)
      .order('min_quantity', { ascending: true })
      .limit(2000)
      .returns<{ product_pack_id: string; min_quantity: number; price_per_piece: number }[]>(),
  ]);

  const readFailed = Boolean(packResult.error || priceResult.error || tierResult.error);
  const readFailure = packResult.error?.message ?? priceResult.error?.message ?? tierResult.error?.message ?? null;

  const packs = packResult.data ?? [];
  const pricesByPack = new Map<string, { id: string; category: RetailerCategory; price: number }[]>();
  for (const row of priceResult.data ?? []) {
    const list = pricesByPack.get(row.product_pack_id) ?? [];
    list.push({ id: row.id, category: normalizeRetailerCategory(row.retailer_category), price: Number(row.price_per_piece) });
    pricesByPack.set(row.product_pack_id, list);
  }
  const slabsByPack = new Map<string, number[]>();
  for (const row of tierResult.data ?? []) {
    const list = slabsByPack.get(row.product_pack_id) ?? [];
    list.push(Number(row.price_per_piece));
    slabsByPack.set(row.product_pack_id, list);
  }

  const configuredCount = packs.filter((pack) => (pricesByPack.get(pack.id) ?? []).length > 0).length;

  return (
    <div className="space-y-6">
      <header>
        <div className="flex items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-ink-950">
            <IndianRupee className="h-5 w-5 text-white" />
          </span>
          <h1 className="text-xl font-semibold text-ink-950 sm:text-2xl">Retailer Category Pricing</h1>
        </div>
        <p className="mt-1 flex items-center gap-1.5 text-xs text-ink-500">
          <ShieldCheck className="h-3.5 w-3.5 text-mint-600" />
          {configuredCount} of {packs.length} active packs have category prices · Gold ≤ Silver ≤ General · checkout
          re-prices every line from the database
        </p>
      </header>

      {readFailed && <ReadFailureNotice what="retailer category prices" detail={readFailure} />}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">How these prices are used</CardTitle>
        </CardHeader>
        <ul className="list-disc space-y-1 pl-5 text-xs text-ink-600">
          <li>
            Prices are GST-inclusive <strong>per piece</strong>, in the same unit as the existing quantity slabs.
          </li>
          <li>
            A configured category price is authoritative for that pack and retailer category — quantity slabs do not
            override it. Packs without category prices keep their existing slab/case pricing.
          </li>
          <li>General retailers can never see or be charged a Silver/Gold price; the fallback is always “general”.</li>
          <li>
            Seller (third-party) offers are never re-priced here: a category price cannot reduce a seller&apos;s
            approved offer price or settlement.
          </li>
          <li>Every change is RLS-restricted to admins and validated by a database trigger.</li>
        </ul>
      </Card>

      <section className="space-y-3">
        {packs.length === 0 ? (
          <Card className="p-6 text-sm text-ink-500">No active packs found.</Card>
        ) : (
          packs.map((pack) => (
            <Card key={pack.id}>
              <CategoryPriceEditor
                packId={pack.id}
                productName={pack.products?.name ?? 'Unknown product'}
                packName={pack.pack_name}
                prices={pricesByPack.get(pack.id) ?? []}
                slabPrices={slabsByPack.get(pack.id) ?? []}
              />
            </Card>
          ))
        )}
      </section>
    </div>
  );
}
