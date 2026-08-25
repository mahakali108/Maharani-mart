import 'server-only';

import { createClient } from '@/lib/supabase/server';
import { calculateCreditPosition, roundMoney, type CreditPosition } from '@/lib/orders/credit';
import { getProductPriceOverrides, resolvePackPrice } from '@/lib/retailer/effective-price';

export interface RequestedQuoteLine {
  packId: string;
  quantity: number;
}

export interface QuotedOrderLine {
  productId: string;
  productName: string;
  packId: string;
  packName: string;
  quantity: number;
  moq: number;
  unitPrice: number;
  gstPercent: number;
  subtotal: number;
  gst: number;
  lineTotal: number;
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
  moq: number;
  is_active: boolean;
  products: { id: string; name: string; gst_percent: number; is_active: boolean } | null;
}

export function normalizeQuoteLines(lines: RequestedQuoteLine[]): { error: string } | { lines: Map<string, number> } {
  if (lines.length === 0) return { error: 'Add at least one product to the order.' };
  if (lines.length > 200) return { error: 'An order can contain at most 200 different packs.' };

  const normalized = new Map<string, number>();
  for (const line of lines) {
    if (!line.packId || !Number.isInteger(line.quantity) || line.quantity < 1 || line.quantity > 100000) {
      return { error: 'Every order line must have a valid whole-number quantity.' };
    }
    if (normalized.has(line.packId)) return { error: 'The same pack cannot be added more than once.' };
    normalized.set(line.packId, line.quantity);
  }
  return { lines: normalized };
}

/**
 * Authoritative, read-only order validation and quote path. It reuses the same
 * catalog, MOQ, pricing, GST and credit rules as order creation. Callers may
 * present this quote, but createOrderForRetailer always quotes again before a
 * write so a stale AI/cart quote can never become an order unchecked.
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
    .select('id, product_id, pack_name, base_price, ptr, moq, is_active, products ( id, name, gst_percent, is_active )')
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
    if (quantity < pack.moq) {
      return { error: `Minimum order quantity for ${pack.products.name} (${pack.pack_name}) is ${pack.moq}.` };
    }
  }

  const productIds = [...new Set(packs.map((pack) => pack.product_id))];
  const overrides = await getProductPriceOverrides(supabase, productIds, retailer.id, retailer.area_id);

  let subtotal = 0;
  let gstTotal = 0;
  const quotedLines: QuotedOrderLine[] = [];
  for (const [packId, quantity] of normalized) {
    const pack = packById.get(packId)!;
    const product = pack.products!;
    const unitPrice = roundMoney(resolvePackPrice(pack, overrides.get(pack.product_id) ?? null));
    const taxed = calculateTaxedLine(unitPrice, quantity, product.gst_percent);
    const lineSubtotal = taxed.subtotal;
    const lineGst = taxed.gst;
    subtotal = roundMoney(subtotal + lineSubtotal);
    gstTotal = roundMoney(gstTotal + lineGst);
    quotedLines.push({
      productId: pack.product_id,
      productName: product.name,
      packId,
      packName: pack.pack_name,
      quantity,
      moq: pack.moq,
      unitPrice,
      gstPercent: product.gst_percent,
      subtotal: lineSubtotal,
      gst: lineGst,
      lineTotal: taxed.total,
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
