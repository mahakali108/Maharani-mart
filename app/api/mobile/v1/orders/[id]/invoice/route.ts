import { z } from 'zod';
import { enforceRateLimit, jsonError, jsonOk, logServerError, newRequestId } from '@/lib/mobile';
import { requireRetailerCommerceSession } from '@/lib/mobile/commerce-route';
import { createClient } from '@/lib/supabase/server';
import { toPaise } from '@/lib/retailer/case-pricing';
import { computeInvoiceTaxLines } from '@/lib/retailer/invoice-tax';
import { ORDER_SUMMARY_NOTICE, orderSummaryTaxMode } from '@/lib/retailer/order-document';
import { toInvoiceDisplayLines, type InvoiceOrderItemRow } from '@/lib/retailer/invoice-display';

export const dynamic = 'force-dynamic';

/**
 * GET /api/mobile/v1/orders/{id}/invoice — legacy URL for an ORDER SUMMARY,
 * not a tax invoice. No seller-of-record or issued tax document is stored.
 * The route retains stored amounts in integer paise; both web and native use
 * the same unsplit, unverified tax summary. No Kotlin tax arithmetic.
 *
 * Money is returned in integer paise (contract §1.5), converted from the
 * rupee columns with the shared `toPaise`.
 */

const ORDER_SELECT = 'id, order_number, status, subtotal, gst_total, discount_total, grand_total, placed_at';

const ITEM_SELECT =
  'id, product_id, pack_id, quantity, quantity_unit, quantity_pieces, units_per_case, unit_price, gst_percent, line_total, products ( name, hsn_code, brands ( name ) ), product_packs ( pack_name, units_per_case )';

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

interface RetailerInvoiceRow {
  shop_name: string | null;
  gstin: string | null;
  address: string | null;
  areas: { name: string } | null;
}

export async function GET(
  request: Request,
  { params }: { params: { id: string } }
): Promise<Response> {
  const requestId = newRequestId();
  const auth = await requireRetailerCommerceSession(request, requestId, 'orders.view.own');
  if ('response' in auth) return auth.response;
  const limited = enforceRateLimit('read.orders', request, {
    requestId,
    keySuffix: auth.session.userId,
  });
  if (limited) return limited;
  if (!z.string().uuid().safeParse(params.id).success) {
    return jsonError('not_found', 'This order summary could not be found.', { status: 404, requestId });
  }

  try {
    const supabase = auth.session.supabase as unknown as ReturnType<typeof createClient>;
    // Ownership FIRST, children second: an order the caller does not own must
    // never cause a read of its items, even though RLS would return nothing.
    const orderResult = await supabase
      .from('orders')
      .select(ORDER_SELECT)
      .eq('id', params.id)
      .eq('retailer_id', auth.session.userId)
      .maybeSingle<OrderInvoiceRow>();
    if (orderResult.error) throw orderResult.error;
    if (!orderResult.data) {
      return jsonError('not_found', 'This order summary could not be found.', { status: 404, requestId });
    }
    const order = orderResult.data;

    const [retailerResult, itemResult] = await Promise.all([
      supabase
        .from('retailers')
        .select('shop_name, gstin, address, areas ( name )')
        .eq('id', auth.session.userId)
        .maybeSingle<RetailerInvoiceRow>(),
      supabase
        .from('order_items')
        .select(ITEM_SELECT)
        .eq('order_id', params.id),
    ]);
    if (retailerResult.error) throw retailerResult.error;
    if (itemResult.error) throw itemResult.error;

    const retailer = retailerResult.data ?? null;
    const items = (itemResult.data ?? []) as unknown as InvoiceOrderItemRow[];

    const lines = toInvoiceDisplayLines(items);
    // Do not infer an issuer, supply state or tax type from env/profile GSTINs.
    const taxMode = orderSummaryTaxMode();
    const tax = computeInvoiceTaxLines(
      taxMode,
      lines.map((line) => ({
        lineKey: line.key,
        lineTotal: line.total,
        gstPercent: line.gstPercent,
      }))
    );
    const taxByLine = new Map(tax.lines.map((line) => [line.lineKey, line]));

    return jsonOk(
      {
        orderId: order.id,
        orderNumber: order.order_number,
        status: order.status,
        placedAt: order.placed_at,
        documentType: 'order_summary',
        documentNotice: ORDER_SUMMARY_NOTICE,
        // Legacy per-line tax fields are estimates; only the saved order totals
        // are authoritative for the order summary, not a verified tax return.
        taxBreakdownVerified: false,
        // No verified issuer is attached to this historical order.
        biller: { name: null, gstin: null, address: null, phone: null },
        billedTo: {
          shopName: retailer?.shop_name ?? null,
          address: retailer?.address ?? null,
          areaName: retailer?.areas?.name ?? null,
          gstin: retailer?.gstin ?? null,
        },
        taxMode,
        lines: lines.map((line) => {
          const lineTax = taxByLine.get(line.key);
          return {
            key: line.key,
            displayName: line.displayName,
            packName: line.packName,
            hsn: line.hsn,
            quantityLabel: line.quantityLabel,
            unitPrices: line.unitPrices.map((unitPrice) => ({
              unitPricePaise: toPaise(unitPrice.price),
              unit: unitPrice.unit,
            })),
            gstPercent: line.gstPercent,
            lineTotalPaise: toPaise(line.total),
            taxPaise: toPaise(lineTax?.tax ?? 0),
            cgstPaise: toPaise(lineTax?.cgst ?? 0),
            sgstPaise: toPaise(lineTax?.sgst ?? 0),
            igstPaise: toPaise(lineTax?.igst ?? 0),
          };
        }),
        totals: {
          subtotalPaise: toPaise(order.subtotal),
          // The STORED order tax wins, exactly as the web invoice prints it.
          gstTotalPaise: toPaise(order.gst_total),
          cgstPaise: toPaise(tax.totals.cgst),
          sgstPaise: toPaise(tax.totals.sgst),
          igstPaise: toPaise(tax.totals.igst),
          discountPaise: toPaise(order.discount_total),
          grandTotalPaise: toPaise(order.grand_total),
        },
      },
      { requestId }
    );
  } catch (cause) {
    logServerError('orders.invoice', requestId, cause);
    return jsonError('database_unavailable', 'This order summary could not be loaded. Please try again.', {
      status: 503,
      requestId,
    });
  }
}
