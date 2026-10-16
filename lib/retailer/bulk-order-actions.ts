'use server';

import { createClient } from '@/lib/supabase/server';
import { requirePermission } from '@/lib/admin/guard';
import { addCartLines } from '@/lib/retailer/cart-service';
import { parseBulkOrderLines } from '@/lib/retailer/bulk-shared';
import { piecePriceFromCase } from '@/lib/retailer/case-pricing';
import { getProductPriceOverrides, resolvePackPrice } from '@/lib/retailer/effective-price';

interface BulkRow {
  id: string;
  name: string;
  gst_percent: number;
  brands: { name: string } | null;
  product_packs: {
    id: string;
    pack_name: string;
    barcode: string | null;
    units_per_case: number;
    base_price: number;
    ptr: number | null;
    case_price: number;
    mrp: number | null;
    moq: number;
    allow_loose_pieces: boolean;
    is_active: boolean;
  }[];
}

const BULK_PRODUCT_SELECT =
  'id, name, gst_percent, brands ( name ), product_images ( image_url, sort_order ), ' +
  'product_packs ( id, pack_name, barcode, units_per_case, base_price, ptr, case_price, mrp, moq, allow_loose_pieces, is_active )';

export interface BulkMatchPack {
  packId: string;
  packName: string;
  moq: number;
  allowLoosePieces: boolean;
  unitPrice: number;
}

export interface BulkMatch {
  line: string;
  quantity: number | null;
  productId: string;
  productName: string;
  brandName: string | null;
  matches: BulkMatchPack[];
  error?: string;
}

/**
 * Resolves each pasted line to up to 3 real packs by name/brand/barcode —
 * the same retailer-visible fields the catalog search covers. Prices come
 * from the server-side effective-price engine for THIS retailer; no money
 * value originates in the browser.
 */
export async function matchBulkLinesAction(raw: string): Promise<{ error?: string; matches?: BulkMatch[] }> {
  const user = await requirePermission('orders.create');
  if (user.role !== 'retailer') return { error: 'Only a retailer can use bulk order entry.' };

  const lines = parseBulkOrderLines(raw);
  if (lines.length === 0) return { error: 'Paste at least one line, e.g. `2 x tea 250g`.' };

  const supabase = createClient();
  const { data: retailer } = await supabase
    .from('retailers')
    .select('area_id')
    .eq('id', user.id)
    .maybeSingle<{ area_id: string }>();

  const matches: BulkMatch[] = [];
  const allProductIds: string[] = [];

  // Resolve terms to products first (bounded: 20 lines × 3 candidates).
  const perLineProducts: { line: (typeof lines)[number]; rows: BulkRow[] }[] = [];
  for (const line of lines) {
    const like = `%${line.term}%`;
    const [{ data: packMatches }, { data: directMatches }] = await Promise.all([
      supabase
        .from('product_packs')
        .select('product_id')
        .eq('is_active', true)
        .or(`pack_name.ilike."${like}",barcode.ilike."${like}"`)
        .limit(30),
      supabase
        .from('products')
        .select(BULK_PRODUCT_SELECT)
        .eq('is_active', true)
        .or(`name.ilike."${like}",barcode.ilike."${like}"`)
        .order('name')
        .limit(6),
    ]);
    // Follow the pack/barcode hit through to its active parent product. The
    // old query discarded packMatches, so scanning a pack barcode returned no
    // product unless that barcode happened to be copied onto the product.
    const packProductIds = [...new Set(
      ((packMatches ?? []) as { product_id: string }[]).map((pack) => pack.product_id)
    )].slice(0, 6);
    const { data: viaPacks } = packProductIds.length > 0
      ? await supabase.from('products').select(BULK_PRODUCT_SELECT)
          .eq('is_active', true).in('id', packProductIds).limit(6)
      : { data: [] as BulkRow[] };
    const seen = new Set<string>();
    const rows = ([...(viaPacks ?? []), ...(directMatches ?? [])] as BulkRow[])
      .filter((row) => row.product_packs.some((pack) => pack.is_active))
      .filter((row) => {
        if (seen.has(row.id)) return false;
        seen.add(row.id);
        return true;
      })
      .slice(0, 6);
    perLineProducts.push({ line, rows });
    for (const row of rows) allProductIds.push(row.id);
  }

  // One override pass for every candidate product.
  const overrides = await getProductPriceOverrides(supabase, [...new Set(allProductIds)], user.id, retailer?.area_id ?? null);

  for (const { line, rows } of perLineProducts) {
    if (rows.length === 0) {
      matches.push({ line: line.line, quantity: line.quantity, productId: '', productName: line.term, brandName: null, matches: [], error: 'No matching product found.' });
      continue;
    }
    const row = rows[0];
    if (!row) {
      matches.push({ line: line.line, quantity: line.quantity, productId: '', productName: line.term, brandName: null, matches: [], error: 'No orderable pack found.' });
      continue;
    }
    const term = line.term.toLowerCase();
    const packs = row.product_packs
      .filter((pack) => pack.is_active)
      .sort((a, b) =>
        Number(b.pack_name.toLowerCase().includes(term) || b.barcode?.toLowerCase().includes(term)) -
        Number(a.pack_name.toLowerCase().includes(term) || a.barcode?.toLowerCase().includes(term))
      )
      .slice(0, 3)
      .map((pack) => {
        const casePrice = resolvePackPrice(pack, overrides.get(row.id) ?? null);
        return {
          packId: pack.id,
          packName: pack.pack_name,
          moq: pack.moq,
          allowLoosePieces: pack.allow_loose_pieces,
          unitPrice: piecePriceFromCase(casePrice, pack.units_per_case),
        };
      });
    matches.push({
      line: line.line,
      quantity: line.quantity,
      productId: row.id,
      productName: row.name,
      brandName: row.brands?.name ?? null,
      matches: packs,
    });
  }

  return { matches };
}

/**
 * Adds the confirmed bulk lines to the cart through the SAME validation
 * (MOQ, whole pieces, availability) as every other add path.
 */
export async function addBulkLinesAction(lines: { packId: string; quantity: number }[]): Promise<{ error?: string; addedCount?: number }> {
  const user = await requirePermission('orders.create');
  if (user.role !== 'retailer') return { error: 'Only a retailer can add to this cart.' };
  if (lines.length < 1 || lines.length > 100) return { error: 'Add between 1 and 100 lines.' };

  // De-duplicate by pack (last quantity wins) and drop malformed rows before
  // validation — a pasted list can contain anything.
  const byPack = new Map<string, number>();
  for (const line of lines) {
    if (!line.packId || !Number.isInteger(line.quantity) || line.quantity < 1 || line.quantity > 100000) continue;
    byPack.set(line.packId, line.quantity);
  }
  if (byPack.size === 0) return { error: 'No valid lines to add.' };

  const result = await addCartLines(createClient(), user.id, [...byPack.entries()].map(([packId, quantity]) => ({ packId, quantity })));
  if ('error' in result) return { error: result.error };
  return { addedCount: byPack.size };
}
