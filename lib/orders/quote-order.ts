import 'server-only';

import { createClient } from '@/lib/supabase/server';
import { calculateCreditPosition, roundMoney, type CreditPosition } from '@/lib/orders/credit';
import { getProductPriceOverrides, resolvePackCasePrice } from '@/lib/retailer/effective-price';
import { calculateCaseLoosePrice, type PricingTier } from '@/lib/retailer/case-pricing';
import { loadPackTiers } from '@/lib/retailer/pricing-data';

export interface RequestedQuoteLine {
  packId: string;
  /**
   * Total PIECES the retailer wants (0026 onward — before this migration the
   * same field counted whole packs/cases). A line may therefore be a partial
   * case (6 pcs), exactly one case (40 pcs) or a case count plus a remainder
   * (46 pcs = 1 case + 6 loose).
   */
  quantity: number;
}

/**
 * One persisted `order_items` row. A mixed line produces two rows so that every
 * row satisfies `unit_price × quantity = line_total` exactly — a case row is
 * billed in cases at the case price, a loose row in pieces at the loose tier
 * price. Nothing is ever blended into a fake unit price.
 */
export interface QuotedOrderItem {
  quantity: number;
  quantityUnit: 'cases' | 'pieces';
  /** Pieces this row covers, snapshotted for invoice/reorder/dispatch. */
  quantityPieces: number;
  unitsPerCase: number;
  /** GST-INCLUSIVE price of ONE row unit. */
  unitPrice: number;
  /** GST-INCLUSIVE line total for this row. */
  lineTotal: number;
  /** GST-exclusive value of the row. */
  subtotal: number;
  /** GST component already contained inside `lineTotal`. */
  gst: number;
}

export interface QuotedOrderLine {
  productId: string;
  productName: string;
  packId: string;
  packName: string;
  /** Pieces ordered. */
  quantity: number;
  moq: number;
  unitsPerCase: number;
  pieces: number;
  cases: number;
  loosePieces: number;
  piecePrice: number;
  casePrice: number;
  /**
   * Effective GST-INCLUSIVE price per piece actually charged on this line
   * (`lineTotal / pieces`), for display only. The persisted rows never use it:
   * each `order_items` row carries its own exact `unit_price`, so a mixed
   * line cannot introduce a rounding drift anywhere in accounting.
   */
  unitPrice: number;
  gstPercent: number;
  /** Line total EXCLUDING the GST component. */
  subtotal: number;
  /** GST component already contained inside `lineTotal`. */
  gst: number;
  /** GST-INCLUSIVE line total. */
  lineTotal: number;
  /** Case price used (source of truth), and the loose rate that was applied. */
  looseUnitPrice: number | null;
  loosePriceSource: 'tier' | 'derived' | 'gap' | 'none';
  /** The loose slab that priced the remainder, when one applied. */
  looseTier: PricingTier | null;
  /** Rows to persist for this line: one, or two when there is a loose remainder. */
  items: QuotedOrderItem[];
}

export interface OrderQuote {
  retailerId: string;
  subtotal: number;
  gstTotal: number;
  discountTotal: number;
  grandTotal: number;
  lines: QuotedOrderLine[];
  credit: CreditPosition;
}

export type QuoteOrderResult = { error: string } | { quote: OrderQuote };

/**
 * Legacy GST calculation helper (GST added on top of a pre-tax price).
 *
 * The case-based pricing model is GST-INCLUSIVE, so this helper is only kept
 * for backwards compatibility with older call sites/tests. New pricing paths
 * use `calculateCaseLoosePrice`, which treats the selling price as inclusive
 * and extracts the GST component instead of adding it.
 */
export function calculateTaxedLine(unitPrice: number, quantity: number, gstPercent: number) {
  const subtotal = roundMoney(unitPrice * quantity);
  const gst = roundMoney((subtotal * gstPercent) / 100);
  return { subtotal, gst, total: roundMoney(subtotal + gst) };
}

interface RetailerForQuote {
  id: string;
  area_id: string;
  status: 'pending_approval' | 'active' | 'suspended';
  credit_limit: number;
  outstanding_balance: number;
}

interface PackForQuote {
  id: string;
  product_id: string;
  pack_name: string;
  base_price: number;
  ptr: number | null;
  case_price: number;
  units_per_case: number;
  moq: number;
  allow_loose_pieces?: boolean;
  is_active: boolean;
  products: { id: string; name: string; gst_percent: number; is_active: boolean } | null;
}

export function normalizeQuoteLines(lines: RequestedQuoteLine[]): { error: string } | { lines: Map<string, number> } {
  if (lines.length === 0) return { error: 'Add at least one product to the order.' };
  if (lines.length > 200) return { error: 'An order can contain at most 200 different packs.' };

  const normalized = new Map<string, number>();
  for (const line of lines) {
    // `quantity` is a piece count: any whole number of pieces is acceptable,
    // whether or not it lines up with a full case.
    if (!line.packId || !Number.isInteger(line.quantity) || line.quantity < 1 || line.quantity > 100000) {
      return { error: 'Every order line must have a valid whole number of pieces.' };
    }
    if (normalized.has(line.packId)) return { error: 'The same pack cannot be added more than once.' };
    normalized.set(line.packId, line.quantity);
  }
  return { lines: normalized };
}

/**
 * Authoritative, read-only order validation and quote path. It reuses the same
 * catalog, MOQ, case + loose-piece, GST-inclusive and credit rules as order
 * creation. Callers may present this quote, but createOrderForRetailer always
 * quotes again before a write so a stale AI/cart quote can never become an
 * order unchecked.
 *
 * NOTHING about money comes from the client. The browser contributes only
 * "which pack, how many pieces". Case price, loose tier, tier selection,
 * discount, GST and every total are re-read and re-computed here from
 * Supabase, through the same pure engine the UI previews with.
 */
export async function quoteOrderForRetailer({
  retailerId,
  lines,
  supabase = createClient(),
}: {
  retailerId: string;
  lines: RequestedQuoteLine[];
  supabase?: ReturnType<typeof createClient>;
}): Promise<QuoteOrderResult> {
  const normalizedResult = normalizeQuoteLines(lines);
  if ('error' in normalizedResult) return normalizedResult;
  const normalized = normalizedResult.lines;

  const { data: retailer, error: retailerError } = await supabase
    .from('retailers')
    .select('id, area_id, status, credit_limit, outstanding_balance')
    .eq('id', retailerId)
    .maybeSingle<RetailerForQuote>();

  if (retailerError || !retailer) return { error: 'Retailer not found or not assigned to you.' };
  if (retailer.status !== 'active') return { error: 'Orders can only be created for an active retailer.' };

  const { data: packData, error: packError } = await supabase
    .from('product_packs')
    .select(
      'id, product_id, pack_name, base_price, ptr, case_price, units_per_case, moq, allow_loose_pieces, is_active, products ( id, name, gst_percent, is_active )'
    )
    .in('id', [...normalized.keys()]);
  if (packError) return { error: 'The product catalog could not be loaded. Please try again.' };

  const packs = (packData ?? []) as unknown as PackForQuote[];
  const packById = new Map(packs.map((pack) => [pack.id, pack]));
  for (const [packId, quantity] of normalized) {
    const pack = packById.get(packId);
    if (!pack?.products) return { error: 'One of the selected packs no longer exists.' };
    if (!pack.is_active || !pack.products.is_active) {
      return { error: `${pack.products.name} (${pack.pack_name}) is no longer available.` };
    }
    // MOQ is a PIECE floor and never forces a full case.
    if (quantity < pack.moq) {
      return {
        error: `Minimum order quantity for ${pack.products.name} (${pack.pack_name}) is ${pack.moq} pcs.`,
      };
    }
  }

  const productIds = [...new Set(packs.map((pack) => pack.product_id))];
  const overrides = await getProductPriceOverrides(supabase, productIds, retailer.id, retailer.area_id);
  const tierMap = await loadPackTiers(supabase, [...normalized.keys()]);

  let subtotal = 0;
  let gstTotal = 0;
  const quotedLines: QuotedOrderLine[] = [];
  for (const [packId, quantity] of normalized) {
    const pack = packById.get(packId)!;
    const product = pack.products!;

    const casePrice = roundMoney(resolvePackCasePrice(pack, overrides.get(pack.product_id) ?? null));
    const pricing = calculateCaseLoosePrice({
      quantity,
      unitsPerCase: pack.units_per_case,
      casePrice,
      tiers: tierMap.get(packId) ?? [],
      gstPercent: product.gst_percent,
      moq: pack.moq,
      allowLoosePieces: pack.allow_loose_pieces !== false,
    });

    // The engine has the final say on orderability: a loose remainder the admin
    // never priced (or a partial case on a whole-case-only pack) is rejected
    // here rather than being silently priced by another rule.
    if (!pricing.orderable) {
      return {
        error: `${product.name} (${pack.pack_name}): ${pricing.message ?? 'That quantity cannot be ordered right now.'}`,
      };
    }

    const items: QuotedOrderItem[] = [];

    // Full cases first: the case price is the source of truth for that part and
    // the loose remainder is priced separately by its own tier. Two exact rows
    // beat one blended row, because every stored line then satisfies
    // unit_price × quantity = line_total to the paisa.
    const caseGst = gstOf(pricing.caseSubtotal, product.gst_percent);
    if (pricing.fullCases > 0) {
      items.push({
        quantity: pricing.fullCases,
        quantityUnit: 'cases',
        quantityPieces: pricing.fullCases * pricing.unitsPerCase,
        unitsPerCase: pricing.unitsPerCase,
        unitPrice: pricing.casePrice,
        lineTotal: pricing.caseSubtotal,
        subtotal: roundMoney(pricing.caseSubtotal - caseGst),
        gst: caseGst,
      });
    }
    const looseGst = gstOf(pricing.looseSubtotal, product.gst_percent);
    if (pricing.looseQuantity > 0 && pricing.looseUnitPrice !== null) {
      items.push({
        quantity: pricing.looseQuantity,
        quantityUnit: 'pieces',
        quantityPieces: pricing.looseQuantity,
        unitsPerCase: pricing.unitsPerCase,
        unitPrice: pricing.looseUnitPrice,
        lineTotal: pricing.looseSubtotal,
        subtotal: roundMoney(pricing.looseSubtotal - looseGst),
        gst: looseGst,
      });
    }

    // The line and order headers are summed from those rows, so
    // Σ order_items.line_total === orders.grand_total by construction.
    const lineSubtotal = roundMoney(items.reduce((sum, item) => sum + item.subtotal, 0));
    const lineGst = roundMoney(items.reduce((sum, item) => sum + item.gst, 0));
    subtotal = roundMoney(subtotal + lineSubtotal);
    gstTotal = roundMoney(gstTotal + lineGst);

    quotedLines.push({
      productId: pack.product_id,
      productName: product.name,
      packId,
      packName: pack.pack_name,
      quantity,
      moq: pack.moq,
      unitsPerCase: pack.units_per_case,
      pieces: pricing.quantity,
      cases: pricing.fullCases,
      loosePieces: pricing.looseQuantity,
      piecePrice: pricing.looseUnitPrice ?? pricing.derivedPiecePrice,
      casePrice: pricing.casePrice,
      unitPrice: roundMoney(pricing.total / Math.max(pricing.quantity, 1)),
      gstPercent: product.gst_percent,
      subtotal: lineSubtotal,
      gst: lineGst,
      lineTotal: pricing.total,
      looseUnitPrice: pricing.looseUnitPrice,
      loosePriceSource: pricing.loosePriceSource,
      looseTier: pricing.looseTier,
      items,
    });
  }

  const grandTotal = roundMoney(subtotal + gstTotal);
  return {
    quote: {
      retailerId: retailer.id,
      subtotal,
      gstTotal,
      discountTotal: 0,
      grandTotal,
      lines: quotedLines,
      credit: calculateCreditPosition(retailer.credit_limit, retailer.outstanding_balance, grandTotal),
    },
  };
}

/**
 * GST already contained inside a GST-INCLUSIVE amount. A full case and a loose
 * remainder extract their own component from their own amount so each persisted
 * row reconciles on its own, and the two still add up to the line's GST.
 */
function gstOf(inclusive: number, gstPercent: number): number {
  return roundMoney((inclusive * gstPercent) / (100 + gstPercent));
}
