import { z } from 'zod';
import { enforceRateLimit, jsonError, jsonOk, logServerError, newRequestId } from '@/lib/mobile';
import { requireRetailerCommerceSession } from '@/lib/mobile/commerce-route';
import { createClient } from '@/lib/supabase/server';
import { toPaise } from '@/lib/retailer/case-pricing';
import { classifyTaxSplit, computeInvoiceTaxLines } from '@/lib/retailer/invoice-tax';
import { toInvoiceDisplayLines, type InvoiceOrderItemRow } from '@/lib/retailer/invoice-display';

export const dynamic = 'force-dynamic';

/**
 * GET /api/mobile/v1/orders/{id}/invoice — the GST invoice for one order the
 * caller owns.
 *
 * This route contains NO tax arithmetic of its own. It folds the stored order
 * rows with the exact same helpers the retailer invoice page uses
 * (`toInvoiceDisplayLines`, `classifyTaxSplit`, `computeInvoiceTaxLines`), so
 * the app and the web invoice can never disagree about a paisa — which is the
 * whole reason ORD-03 was blocked until this endpoint existed. Re-deriving GST
 * in Kotlin would have created a second implementation of tax arithmetic.
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

/** Company identity for the invoice header; null when not configured. */
function companyField(value: string | undefined): string | null {
  const trimmed = (value ?? '').trim();
  return trimmed.length > 0 ? trimmed : null;
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
    return jsonError('not_found', 'This invoice could not be found.', { status: 404, requestId });
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
      return jsonError('not_found', 'This invoice could not be found.', { status: 404, requestId });
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
    if (itemResult.error) throw itemResult.error;

    const retailer = retailerResult.data ?? null;
    const items = (itemResult.data ?? []) as unknown as InvoiceOrderItemRow[];

    const lines = toInvoiceDisplayLines(items);
    // CGST/SGST vs IGST is decided only from real GSTIN state codes; when
    // either side is missing the tax stays unsplit — never guessed.
    const taxMode = classifyTaxSplit(companyField(process.env.COMPANY_GSTIN), retailer?.gstin ?? null);
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
        biller: {
          name: companyField(process.env.COMPANY_NAME),
          gstin: companyField(process.env.COMPANY_GSTIN),
          address: companyField(process.env.COMPANY_ADDRESS),
          phone: companyField(process.env.COMPANY_PHONE),
        },
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
    return jsonError('database_unavailable', 'This invoice could not be loaded. Please try again.', {
      status: 503,
      requestId,
    });
  }
}
