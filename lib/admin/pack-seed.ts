import 'server-only';

import type { createClient } from '@/lib/supabase/server';
import { piecePriceFromCase } from '@/lib/retailer/case-pricing';

/**
 * Default-pack seeding, shared by the Add Product form
 * (lib/admin/products-actions.ts) and the CSV importer
 * (lib/admin/product-import-actions.ts).
 *
 * This deliberately lives OUTSIDE any `'use server'` module: it is an
 * internal helper that receives an already-authorized Supabase client from
 * its caller, so it must never be registered as a remotely invocable Server
 * Action endpoint. Both callers run their own `requirePermission(...)` guard
 * before reaching this code.
 */

/**
 * Builds the internal pack SKU for the auto-seeded default pack.
 *
 * Products no longer carry an admin-entered SKU code (migration 0023), but
 * `product_packs.pack_sku_code` is still a NOT NULL UNIQUE column, so the
 * default pack gets a deterministic code derived from the product id. It is
 * never entered by an admin and is unique per product.
 */
function defaultPackSkuCode(productId: string) {
  return `PK-${productId.replaceAll('-', '').slice(0, 12).toUpperCase()}`;
}

/**
 * Seeds a default case-priced pack for a product, together with its default
 * and case quantity tiers, so a product created through the Add Product form
 * is immediately orderable at the configured case price.
 *
 * Shared because the CSV importer (lib/admin/product-import-actions.ts) must
 * produce exactly the same shape as the form: an imported product that had no
 * default pack and no quantity tiers would appear in the catalog and then be
 * unorderable, which is worse than rejecting the row.
 */
export async function seedDefaultPackForProduct(
  supabase: ReturnType<typeof createClient>,
  productId: string,
  user: { id: string },
  d: {
    unit: string;
    unitsPerCase: number;
    basePrice: number;
    costPrice: number | null;
    casePrice: number;
    barcode: string | null;
    moq: number;
  }
) {
  // Reference per-piece rate from the engine, so a seeded default slab prices
  // exactly like the derived rate the storefront shows.
  const piecePrice = piecePriceFromCase(d.casePrice, d.unitsPerCase);
  const { data: pack, error } = await supabase
    .from('product_packs')
    .insert({
      product_id: productId,
      pack_name: d.unit || 'Default',
      pack_sku_code: defaultPackSkuCode(productId),
      units_per_case: d.unitsPerCase,
      base_price: d.basePrice,
      mrp: d.basePrice,
      cost_price: d.costPrice,
      case_price: d.casePrice,
      barcode: d.barcode,
      moq: d.moq,
      created_by: user.id,
    } as unknown as never)
    .select('id')
    .single<{ id: string }>();
  if (error || !pack) return;

  // Quantity tiers (in PIECES), half-open [min, max):
  //  - default: [1, units)  — normal applicable pricing below a full case
  //  - case:    [units, ∞)  — at a full case the fixed case price applies
  // For single-piece packs (units=1) one default tier [1, ∞) is enough.
  const tiers =
    d.unitsPerCase > 1
      ? [
          {
            product_pack_id: pack.id,
            min_quantity: 1,
            max_quantity: d.unitsPerCase,
            price_per_piece: piecePrice,
            rule_type: 'default' as const,
            label: 'Default',
            created_by: user.id,
          },
          {
            product_pack_id: pack.id,
            min_quantity: d.unitsPerCase,
            max_quantity: null,
            price_per_piece: piecePrice,
            rule_type: 'case' as const,
            label: 'Case price',
            created_by: user.id,
          },
        ]
      : [
          {
            product_pack_id: pack.id,
            min_quantity: 1,
            max_quantity: null,
            price_per_piece: piecePrice,
            rule_type: 'default' as const,
            label: 'Default',
            created_by: user.id,
          },
        ];
  await supabase.from('product_pricing_tiers').insert(tiers as unknown as never);
}
