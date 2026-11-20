import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { requireUser } from '@/lib/auth/session';
import { classifyTaxSplit } from '@/lib/retailer/invoice-tax';
import { toInvoiceDisplayLines, type InvoiceOrderItemRow } from '@/lib/retailer/invoice-display';
import { buildStandaloneInvoiceHtml } from '@/lib/retailer/invoice-html';
import { getTaxInvoiceReadiness } from '@/lib/retailer/tax-invoice-readiness';
import { BRAND } from '@/lib/brand';

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
 * Downloadable GST invoice (self-contained HTML) for the caller's OWN order.
 *
 * Auth is re-checked here (route handlers bypass page middleware assumptions)
 * and the order query is scoped to `retailer_id = user.id` — a direct URL
 * with someone else's order id yields 403/404, never their data. All amounts
 * come from the stored order/invoice rows; the tax split follows the same
 * GSTIN state-code rule as the on-screen invoice.
 */
export async function GET(request: Request, { params: paramsPromise }: { params: Promise<{ id: string }> }) {
  const params = await paramsPromise;
  const user = await requireUser();
  if (user.role !== 'retailer') {
    return NextResponse.json({ error: 'Only retailers can download invoices.' }, { status: 403 });
  }

  const supabase = (await createClient());

  const [{ data: order }, { data: retailer }, { data: itemData }] = await Promise.all([
    supabase
      .from('orders')
      .select('id, order_number, status, subtotal, gst_total, discount_total, grand_total, placed_at')
      .eq('id', params.id)
      .eq('retailer_id', user.id)
      .maybeSingle<OrderInvoiceRow>(),
    supabase
      .from('retailers')
      .select('shop_name, gstin, address, areas ( name )')
      .eq('id', user.id)
      .maybeSingle<RetailerRow>(),
    supabase
      .from('order_items')
      .select(
        'id, product_id, pack_id, source_type, quantity, quantity_unit, quantity_pieces, units_per_case, unit_price, gst_percent, line_total, products ( name, hsn_code, brands ( name ) ), product_packs ( pack_name, units_per_case )'
      )
      .eq('order_id', params.id),
  ]);

  if (!order) {
    return NextResponse.json({ error: 'Invoice not found.' }, { status: 404 });
  }

  const items = (itemData ?? []) as unknown as (InvoiceOrderItemRow & { source_type?: 'maharani' | 'seller' | null })[];
  const issuance = getTaxInvoiceReadiness({
    hasMarketplaceSellerLine: items.some((item) => item.source_type === 'seller'),
  });
  if (!issuance.ready) {
    return NextResponse.json(
      { error: 'Tax invoice unavailable', message: issuance.message },
      { status: 409, headers: { 'Cache-Control': 'no-store' } }
    );
  }

  const lines = toInvoiceDisplayLines(items);
  const taxMode = classifyTaxSplit(issuance.issuer.gstin, retailer?.gstin ?? null);

  const html = buildStandaloneInvoiceHtml({
    orderNumber: order.order_number,
    placedAt: order.placed_at,
    // The legal issuer (Ajay General) is the company; the brand is shown
    // alongside it, never instead of it. See lib/brand.ts.
    //
    // `brandName` renders as "Trading as ...", so it MUST be the trading style
    // (Maharani Traders) and never the app name. "Trading as Maha Bazar by
    // Maharani" would tell a tax authority that an installable product name is
    // the trade under which the proprietorship operates.
    company: issuance.issuer,
    brandName: BRAND.tradingStyle,
    billedTo: {
      shopName: retailer?.shop_name ?? '',
      address: retailer?.address ?? '',
      areaName: retailer?.areas?.name ?? '',
      gstin: retailer?.gstin ?? '',
    },
    lines,
    taxMode,
    subtotal: order.subtotal,
    gstTotal: order.gst_total,
    discountTotal: order.discount_total,
    grandTotal: order.grand_total,
  });

  const safeNumber = order.order_number.replace(/[^A-Za-z0-9-]/g, '') || 'invoice';
  return new NextResponse(html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Disposition': `attachment; filename="invoice-${safeNumber}.html"`,
      'Cache-Control': 'no-store',
    },
  });
}
