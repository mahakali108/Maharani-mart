import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { requireUser } from '@/lib/auth/session';
import { orderSummaryTaxMode } from '@/lib/retailer/order-document';
import { toInvoiceDisplayLines, type InvoiceOrderItemRow } from '@/lib/retailer/invoice-display';
import { buildStandaloneInvoiceHtml } from '@/lib/retailer/invoice-html';

interface OrderInvoiceRow {
  id: string;
  order_number: string;
  status: string;
  subtotal: number;
  gst_total: number;
  discount_total: number;
  grand_total: number;
  placed_at: string;
}

interface RetailerRow {
  shop_name: string;
  gstin: string | null;
  address: string | null;
  areas: { name: string } | null;
}

/**
 * Downloadable ORDER SUMMARY (self-contained HTML) for the caller's OWN order.
 * Legacy /invoice URL retained for links; this is NOT a GST tax invoice.
 * Auth and `retailer_id = user.id` scope are re-checked here. Stored order
 * amounts remain unchanged; issuer and tax split are not inferred from env.
 */
export async function GET(request: Request, { params }: { params: { id: string } }) {
  const user = await requireUser();
  if (user.role !== 'retailer') {
    return NextResponse.json({ error: 'Only retailers can download order summaries.' }, { status: 403 });
  }

  const supabase = createClient();

  // Verify retailer ownership BEFORE reading order items.
  const { data: order, error: orderError } = await supabase
    .from('orders')
    .select('id, order_number, status, subtotal, gst_total, discount_total, grand_total, placed_at')
    .eq('id', params.id)
    .eq('retailer_id', user.id)
    .maybeSingle<OrderInvoiceRow>();
  if (orderError) {
    return NextResponse.json({ error: 'Order summary unavailable.' }, { status: 503 });
  }
  if (!order) {
    return NextResponse.json({ error: 'Order summary not found.' }, { status: 404 });
  }

  const [{ data: retailer, error: retailerError }, { data: itemData, error: itemError }] = await Promise.all([
    supabase.from('retailers').select('shop_name, gstin, address, areas ( name )')
      .eq('id', user.id).maybeSingle<RetailerRow>(),
    supabase.from('order_items')
      .select('id, product_id, pack_id, quantity, quantity_unit, quantity_pieces, units_per_case, unit_price, gst_percent, line_total, products ( name, hsn_code, brands ( name ) ), product_packs ( pack_name, units_per_case )')
      .eq('order_id', order.id),
  ]);
  if (retailerError || itemError) {
    return NextResponse.json({ error: 'Order summary details unavailable.' }, { status: 503 });
  }
  const items = (itemData ?? []) as unknown as InvoiceOrderItemRow[];
  const lines = toInvoiceDisplayLines(items);

  const html = buildStandaloneInvoiceHtml({
    orderNumber: order.order_number,
    placedAt: order.placed_at,
    billedTo: {
      shopName: retailer?.shop_name ?? '',
      address: retailer?.address ?? '',
      areaName: retailer?.areas?.name ?? '',
      gstin: retailer?.gstin ?? '',
    },
    lines,
    taxMode: orderSummaryTaxMode(),
    subtotal: order.subtotal,
    gstTotal: order.gst_total,
    discountTotal: order.discount_total,
    grandTotal: order.grand_total,
  });

  const safeNumber = order.order_number.replace(/[^A-Za-z0-9-]/g, '') || 'order';
  return new NextResponse(html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Disposition': `attachment; filename="order-summary-${safeNumber}.html"`,
      'Cache-Control': 'no-store',
    },
  });
}
