import { Search } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { requireUser } from '@/lib/auth/session';
import { getProductPriceOverride, resolvePackPrice } from '@/lib/retailer/effective-price';
import { Input } from '@/components/ui/input';
import { AdminEmptyState } from '@/components/admin/empty-state';
import { QuickOrderRow, type QuickOrderPack } from '@/components/retailer/quick-order-row';

interface QuickOrderProductRow {
  id: string;
  name: string;
  sku_code: string;
  gst_percent: number;
  product_packs: {
    id: string;
    pack_name: string;
    units_per_case: number;
    base_price: number;
    ptr: number | null;
    mrp: number | null;
    moq: number;
    is_active: boolean;
  }[];
}

const MAX_RESULTS = 30;

/**
 * Quick Order (Requirement C): search by product name or SKU code and
 * add quantities directly, without navigating to each product page.
 *
 * Everything the catalog flow enforces is enforced identically here:
 *   - only active products with active packs are listed;
 *   - displayed prices come from the shared effective-price helper
 *     (retailer override > area override > pack PTR > base price) —
 *     the same single implementation as catalog/cart/checkout;
 *   - MOQ and availability are re-validated server-side by the
 *     existing addToCartAction on every add.
 *
 * Stock availability: the existing retailer ordering logic does not
 * gate cart/order lines on inventory_stock (that table is staff-read
 * only by RLS policy), so quick order intentionally does not expose
 * stock numbers either — line-level stock checks stay where they
 * already live, in the staff dispatch flow.
 */
export default async function QuickOrderPage({ searchParams }: { searchParams: { q?: string } }) {
  const user = await requireUser();
  const supabase = createClient();
  const q = searchParams.q?.trim() ?? '';

  const { data: retailer } = await supabase
    .from('retailers')
    .select('area_id')
    .eq('id', user.id)
    .maybeSingle<{ area_id: string }>();

  let cards: { id: string; name: string; skuCode: string; gstPercent: number; packs: QuickOrderPack[] }[] = [];
  let searched = false;

  if (q) {
    searched = true;
    const { data: productRows } = await supabase
      .from('products')
      .select(
        'id, name, sku_code, gst_percent, product_packs ( id, pack_name, units_per_case, base_price, ptr, mrp, moq, is_active )'
      )
      .eq('is_active', true)
      .or(`name.ilike.%${q}%,sku_code.ilike.%${q}%`)
      .order('name')
      .limit(MAX_RESULTS)
      .returns<QuickOrderProductRow[]>();

    const products = productRows ?? [];
    const overrides = await Promise.all(
      products.map((p) => getProductPriceOverride(supabase, p.id, user.id, retailer?.area_id ?? null))
    );

    cards = products
      .map((product, i) => {
        const packs: QuickOrderPack[] = product.product_packs
          .filter((pack) => pack.is_active)
          .map((pack) => ({
            id: pack.id,
            packName: pack.pack_name,
            unitsPerCase: pack.units_per_case,
            moq: pack.moq,
            mrp: pack.mrp,
            effectivePrice: resolvePackPrice(pack, overrides[i] ?? null),
          }));
        return {
          id: product.id,
          name: product.name,
          skuCode: product.sku_code,
          gstPercent: product.gst_percent,
          packs,
        };
      })
      .filter((card) => card.packs.length > 0);
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold text-ink-950">Quick order</h1>
        <p className="mt-1 text-sm text-ink-500">
          Search by product name or SKU and enter quantities directly.
        </p>
      </div>

      <form method="get" className="flex gap-2">
        <Input name="q" defaultValue={q} placeholder="e.g. oil, rice, SKU code…" autoFocus />
      </form>

      {!searched ? (
        <AdminEmptyState
          icon={Search}
          title="Search to start a quick order"
          body="Type a product name or SKU code above to add items to your cart."
        />
      ) : cards.length === 0 ? (
        <AdminEmptyState
          icon={Search}
          title="No products match your search"
          body="Check the spelling, or browse the full catalog."
        />
      ) : (
        <div className="space-y-3">
          {cards.map((card) => (
            <QuickOrderRow key={card.id} {...card} />
          ))}
        </div>
      )}
    </div>
  );
}
