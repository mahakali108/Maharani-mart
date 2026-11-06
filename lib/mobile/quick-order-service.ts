import 'server-only';

/**
 * Quick order for the native app.
 *
 * The web quick-order page (`app/retailer/quick-order/page.tsx`) is the
 * contract this mirrors: search active products by name (30 results), price
 * each ACTIVE pack with the same engine the cart and checkout use, and match a
 * pasted list with `lib/retailer/bulk-shared.ts`'s own parser. Nothing here
 * invents an ordering model — both paths end in the existing cart endpoint,
 * which revalidates MOQ, piece steps and availability before anything is saved.
 *
 * Prices are computed server-side for the calling retailer only. Identity comes
 * from the verified session; no retailer id, area id or price is ever read from
 * the request.
 */

import type { createClient } from '@/lib/supabase/server';
import {
  loadCatalogPricing,
  priceCatalogPack,
  type CatalogProductRow,
} from '@/lib/retailer/catalog';
import { normalizeAvailabilityState, type AvailabilityState } from '@/lib/retailer/availability';
import { toPaise } from '@/lib/retailer/case-pricing';
import { resolvePackPrice } from '@/lib/retailer/effective-price';
import { sanitizeSearchTerm } from '@/lib/retailer/catalog-params';
import { parseBulkOrderLines, type ParsedBulkLine } from '@/lib/retailer/bulk-shared';
import type { MobilePriceTier } from '@/lib/mobile/catalog';
import type { MobileSession } from '@/lib/mobile/auth';

type SupabaseClient = Awaited<ReturnType<typeof createClient>>;

/** The web quick-order search's cap (`MAX_RESULTS = 30`). */
export const QUICK_ORDER_MAX_RESULTS = 30;

/** The web bulk matcher's cap: 20 pasted lines, three pack candidates each. */
export const QUICK_ORDER_MAX_BULK_LINES = 20;
const QUICK_ORDER_PACK_CANDIDATES = 3;

/** The catalogue's own pack columns, plus the two the quick rows need. */
const QUICK_ORDER_SELECT =
  'id, name, gst_percent, is_new_launch, created_at, category_id, brand_id, ' +
  'brands ( id, name ), product_images ( image_url, sort_order ), ' +
  'product_packs ( id, pack_name, ptr, base_price, case_price, units_per_case, mrp, moq, allow_loose_pieces, barcode, image_url, is_active, sort_order )';

interface QuickOrderProductRow extends Omit<CatalogProductRow, 'product_packs'> {
  product_packs: (CatalogProductRow['product_packs'][number] & {
    allow_loose_pieces: boolean;
    barcode: string | null;
  })[];
}

export interface MobileQuickOrderPack {
  packId: string;
  packName: string;
  unitsPerCase: number;
  moq: number;
  allowLoosePieces: boolean;
  /** Priced at the pack's MOQ through the shared engine, in paise. */
  unitPricePaise: number | null;
  /** Case price ÷ units per case, the same fallback the web row shows. */
  derivedPiecePricePaise: number | null;
  mrpPaise: number | null;
  tiers: MobilePriceTier[];
  availability: AvailabilityState;
}

export interface MobileQuickOrderProduct {
  id: string;
  name: string;
  brandName: string | null;
  imageUrl: string | null;
  gstPercent: number;
  packs: MobileQuickOrderPack[];
}

export interface MobileBulkMatchPack {
  packId: string;
  packName: string;
  moq: number;
  allowLoosePieces: boolean;
  unitPricePaise: number | null;
  availability: AvailabilityState;
}

export interface MobileBulkMatch {
  line: string;
  /** The pasted quantity, or null for a bare term (the UI fills the pack MOQ). */
  quantity: number | null;
  productId: string;
  productName: string;
  brandName: string | null;
  /** Up to three real packs, priced for this retailer. */
  matches: MobileBulkMatchPack[];
  error?: string;
}

/** A single pricing pass for a set of products, in the shape the mappers want. */
type PricingData = Awaited<ReturnType<typeof loadCatalogPricing>>;

function packsForProduct(product: QuickOrderProductRow, pricingData: PricingData): MobileQuickOrderPack[] {
  const override = pricingData.overrides.get(product.id) ?? null;
  return [...product.product_packs]
    .filter((pack) => pack.is_active)
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((pack): MobileQuickOrderPack => {
      // Priced at the pack's own MOQ through the SAME engine checkout uses, so
      // the number shown is the number an order would be charged.
      const pricing = priceCatalogPack(pack, product, pricingData, pack.moq);
      const unitPrice = pricing.orderable && Number.isFinite(pricing.unitPrice) && pricing.unitPrice > 0
        ? toPaise(pricing.unitPrice)
        : null;
      const casePrice = resolvePackPrice(pack, override);
      const derivedPiece = pack.units_per_case > 0
        ? toPaise(casePrice / pack.units_per_case)
        : null;
      return {
        packId: pack.id,
        packName: pack.pack_name,
        unitsPerCase: pack.units_per_case,
        moq: pack.moq,
        allowLoosePieces: pack.allow_loose_pieces !== false,
        unitPricePaise: unitPrice,
        derivedPiecePricePaise: derivedPiece,
        mrpPaise: pack.mrp == null ? null : toPaise(pack.mrp),
        tiers: (pricingData.packTiers.get(pack.id) ?? []).map((tier) => ({
          minQuantity: tier.min_quantity,
          maxQuantity: tier.max_quantity,
          pricePerPiecePaise: toPaise(tier.price_per_piece),
        })),
        availability: normalizeAvailabilityState(pricingData.availability.get(pack.id)?.state ?? null),
      };
    });
}

function firstImage(product: QuickOrderProductRow): string | null {
  const sorted = [...product.product_images].sort((a, b) => a.sort_order - b.sort_order);
  return sorted[0]?.image_url ?? null;
}

async function loadRetailerAreaId(supabase: SupabaseClient, userId: string): Promise<string | null> {
  const { data } = await supabase
    .from('retailers')
    .select('area_id')
    .eq('id', userId)
    .maybeSingle<{ area_id: string | null }>();
  return data?.area_id ?? null;
}

/**
 * Search the catalogue the way the web quick-order page does: active products
 * whose NAME matches the term, newest names first alphabetically, capped at 30,
 * each with every active pack priced for this retailer.
 */
export async function loadMobileQuickOrderProducts(
  session: MobileSession,
  rawTerm: string,
): Promise<{ term: string; products: MobileQuickOrderProduct[] }> {
  const term = sanitizeSearchTerm(rawTerm);
  if (!term) return { term: '', products: [] };

  const supabase = session.supabase as unknown as SupabaseClient;

  const [{ data: rows, error }, areaId] = await Promise.all([
    supabase
      .from('products')
      .select(QUICK_ORDER_SELECT)
      .eq('is_active', true)
      .ilike('name', `%${term}%`)
      .order('name')
      .limit(QUICK_ORDER_MAX_RESULTS)
      .returns<QuickOrderProductRow[]>(),
    loadRetailerAreaId(supabase, session.userId),
  ]);
  if (error) throw error;

  const products = (rows ?? []).filter((product) =>
    product.product_packs.some((pack) => pack.is_active)
  );
  if (products.length === 0) return { term, products: [] };

  const pricingData = await loadCatalogPricing(supabase, products, session.userId, areaId);

  return {
    term,
    products: products.map((product) => ({
      id: product.id,
      name: product.name,
      brandName: product.brands?.name ?? null,
      imageUrl: firstImage(product),
      gstPercent: product.gst_percent,
      packs: packsForProduct(product, pricingData),
    })),
  };
}

/**
 * Resolve each pasted line to a real product and up to three real packs by
 * product name or barcode — the same retailer-visible fields the web bulk
 * matcher searches, with the same shared parser and the same per-line shape
 * (`2 x tea 250g` / `tea 250g x 24` / a bare term).
 *
 * The pasted lines are untrusted text: the parser caps the count and the term
 * length, a term that matches nothing answers with an explicit per-line error
 * instead of a guess, and no price originates on the device.
 */
export async function matchMobileBulkLines(
  session: MobileSession,
  raw: string,
): Promise<{ matches: MobileBulkMatch[] }> {
  const parsed = parseBulkOrderLines(raw, QUICK_ORDER_MAX_BULK_LINES);
  if (parsed.length === 0) return { matches: [] };

  const supabase = session.supabase as unknown as SupabaseClient;

  const perLineRows: { line: ParsedBulkLine; rows: QuickOrderProductRow[] }[] = [];
  for (const line of parsed) {
    const { data } = await supabase
      .from('products')
      .select(QUICK_ORDER_SELECT)
      .eq('is_active', true)
      .or(`name.ilike."%${line.term}%",barcode.ilike."%${line.term}%"`)
      .order('name')
      .limit(6)
      .returns<QuickOrderProductRow[]>();
    const rows = (data ?? []).filter((row) => row.product_packs.some((pack) => pack.is_active));
    perLineRows.push({ line, rows });
  }

  const candidates = perLineRows.flatMap(({ rows }) => rows);
  const pricingData = candidates.length === 0
    ? null
    : await loadCatalogPricing(
        supabase,
        candidates,
        session.userId,
        await loadRetailerAreaId(supabase, session.userId),
      );

  const matches: MobileBulkMatch[] = [];
  for (const { line, rows } of perLineRows) {
    const row = rows[0];
    if (!row) {
      matches.push({
        line: line.line,
        quantity: line.quantity,
        productId: '',
        productName: line.term,
        brandName: null,
        matches: [],
        error: 'No matching product found.',
      });
      continue;
    }
    if (!pricingData) {
      matches.push({
        line: line.line,
        quantity: line.quantity,
        productId: '',
        productName: line.term,
        brandName: null,
        matches: [],
        error: 'No orderable pack found.',
      });
      continue;
    }
    const packs = row.product_packs
      .filter((pack) => pack.is_active)
      .slice(0, QUICK_ORDER_PACK_CANDIDATES)
      .map((pack): MobileBulkMatchPack => {
        const pricing = priceCatalogPack(pack, row, pricingData, pack.moq);
        const unitPrice = pricing.orderable && Number.isFinite(pricing.unitPrice) && pricing.unitPrice > 0
          ? toPaise(pricing.unitPrice)
          : null;
        return {
          packId: pack.id,
          packName: pack.pack_name,
          moq: pack.moq,
          allowLoosePieces: pack.allow_loose_pieces !== false,
          unitPricePaise: unitPrice,
          availability: normalizeAvailabilityState(pricingData.availability.get(pack.id)?.state ?? null),
        };
      });

    if (packs.length === 0) {
      matches.push({
        line: line.line,
        quantity: line.quantity,
        productId: '',
        productName: line.term,
        brandName: null,
        matches: [],
        error: 'No orderable pack found.',
      });
      continue;
    }

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
