import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Download } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { requireUser } from '@/lib/auth/session';
import { PrintButton } from '@/components/retailer/print-button';
import { formatIndiaDateTime } from '@/lib/datetime/india';
import { computeInvoiceTaxLines } from '@/lib/retailer/invoice-tax';
import { ORDER_SUMMARY_NOTICE, orderSummaryTaxMode } from '@/lib/retailer/order-document';
import { toInvoiceDisplayLines, type InvoiceOrderItemRow } from '@/lib/retailer/invoice-display';

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

export default async function InvoicePage({ params }: { params: { id: string } }) {
  const user = await requireUser();
  if (user.role !== 'retailer') notFound();
  const supabase = createClient();

  // Authorize the parent first. Never query children of a foreign order even
  // when their own RLS would return no rows.
  const { data: order, error: orderError } = await supabase
    .from('orders')
    .select('id, order_number, status, subtotal, gst_total, discount_total, grand_total, placed_at')
    .eq('id', params.id)
    .eq('retailer_id', user.id)
    .maybeSingle<OrderInvoiceRow>();
  if (orderError) throw new Error('Order summary could not be loaded.');
  if (!order) notFound();

  const [{ data: retailer, error: retailerError }, { data: itemData, error: itemError }] = await Promise.all([
    supabase.from('retailers').select('shop_name, gstin, address, areas ( name )')
      .eq('id', user.id).maybeSingle<RetailerRow>(),
    supabase.from('order_items')
      .select('id, product_id, pack_id, quantity, quantity_unit, quantity_pieces, units_per_case, unit_price, gst_percent, line_total, products ( name, hsn_code, brands ( name ) ), product_packs ( pack_name, units_per_case )')
      .eq('order_id', order.id),
  ]);
  if (retailerError || itemError) throw new Error('Order summary details could not be loaded.');
  const items = (itemData ?? []) as unknown as InvoiceOrderItemRow[];
  const lines = toInvoiceDisplayLines(items);

  // The order lines/amounts are stored, but the supplier, tax point, place of
  // supply and immutable issued document have not been verified. Do not
  // infer an issuer from COMPANY_* env vars or guess a CGST/IGST split here.
  const taxMode = orderSummaryTaxMode();
  const tax = computeInvoiceTaxLines(
    taxMode,
    lines.map((line) => ({ lineKey: line.key, lineTotal: line.total, gstPercent: line.gstPercent }))
  );
  const taxByLine = new Map(tax.lines.map((line) => [line.lineKey, line]));

  return (
    <div className="mx-auto max-w-2xl space-y-6 print:max-w-none">
      <div className="shop-intro flex flex-wrap items-center justify-between gap-3 print:hidden">
        <div className="shop-intro">
          <p className="shop-eyebrow">Order documents</p><h1 className="shop-heading mt-1">Order summary</h1><Link href={`/retailer/orders/${order.id}`} className="mt-2 inline-flex min-h-10 items-center text-xs underline underline-offset-4">Back to order</Link></div>
        <div className="flex gap-2">
        <Link
          href={`/retailer/orders/${order.id}/invoice/download`}
          className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-xs font-semibold text-ink-700 transition hover:border-primary-300 hover:text-primary-700"
        >
          <Download className="h-4 w-4" />
          Download summary
        </Link>
        <PrintButton />
        </div>
      </div>

      <div className="rounded-2xl border border-ink-100 bg-white p-6 print:rounded-none print:border-0 print:p-0 sm:p-8">
        <div className="flex min-w-0 flex-wrap items-start justify-between gap-3 border-b border-ink-100 pb-4">
          <div className="min-w-0 flex-1">
            <p className="break-words text-lg font-semibold text-ink-950">Order summary</p>
            <p className="mt-2 max-w-md text-xs text-ink-600">{ORDER_SUMMARY_NOTICE}</p>
          </div>
          <div className="min-w-0 shrink-0 text-right">
            <p className="text-sm font-semibold uppercase tracking-wide text-primary-600">Not a tax invoice</p>
            <p className="break-all font-mono text-sm text-ink-900">{order.order_number}</p>
            <p className="break-words text-xs text-ink-500">
              {formatIndiaDateTime(order.placed_at)}
            </p>
          </div>
        </div>

        <div className="mt-4 min-w-0 border-b border-ink-100 pb-4">
          <p className="text-xs font-medium uppercase tracking-wide text-ink-400">Current account profile (not a billing snapshot)</p>
          <p className="mt-1 break-words text-sm font-semibold text-ink-900">{retailer?.shop_name}</p>
          <p className="break-words text-xs text-ink-500">{retailer?.address ?? '—'}</p>
          {retailer?.areas?.name ? <p className="break-words text-xs text-ink-500">{retailer.areas.name}</p> : null}
          {retailer?.gstin ? <p className="break-words text-xs text-ink-500">GSTIN on account (unverified): {retailer.gstin}</p> : null}
        </div>

        {/* On phones the line-item table scrolls inside its own container so the
            page never grows wider than the screen; print output is unchanged. */}
        <div className="table-scroll mt-4 print:overflow-visible">
          <table className="w-full min-w-[560px] text-sm print:min-w-0">
          <thead>
            <tr className="border-b border-ink-100 text-left text-xs uppercase tracking-wide text-ink-400">
              <th className="py-2 pr-3 font-medium">Item</th>
              <th className="py-2 pr-3 font-medium">Current catalog HSN*</th>
              <th className="py-2 pr-3 font-medium">Qty</th>
              <th className="py-2 pl-3 text-right font-medium">Unit Price</th>
              <th className="py-2 pl-3 text-right font-medium">Recorded GST %</th>
              {taxMode === 'intra' ? (
                <>
                  <th className="py-2 pl-3 text-right font-medium">Estimated CGST*</th>
                  <th className="py-2 pl-3 text-right font-medium">Estimated SGST*</th>
                </>
              ) : taxMode === 'inter' ? (
                <th className="py-2 pl-3 text-right font-medium">Estimated IGST*</th>
              ) : (
                <th className="py-2 pl-3 text-right font-medium">Estimated GST*</th>
              )}
              <th className="py-2 pl-3 text-right font-medium">Total</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-ink-50">
            {lines.map((line) => {
              const lineTax = taxByLine.get(line.key);
              return (
              <tr key={line.key}>
                <td className="py-2">
                  <p className="font-medium text-ink-900">{line.displayName}</p>
                  <p className="font-mono text-xs text-ink-400">{line.packName}</p>
                </td>
                <td className="py-2 font-mono text-xs text-ink-500">{line.hsn ?? '—'}</td>
                <td className="py-2 text-ink-600">{line.quantityLabel}</td>
                <td className="py-2 text-right text-ink-600">
                  {/* Each row is printed with the unit it was billed in. New
                      orders bill one pieces row per line; only pre-piece
                      historical rows can carry a 'cases' unit. */}
                  <ul className="space-y-0.5">
                    {line.unitPrices.map((unitPrice) => (
                      <li key={`${unitPrice.unit}-${unitPrice.price}`}>
                        ₹{unitPrice.price.toFixed(2)}
                        <span className="text-ink-400"> / {unitPrice.unit}</span>
                      </li>
                    ))}
                  </ul>
                </td>
                <td className="py-2 text-right text-ink-600">{line.gstPercent}%</td>
                {taxMode === 'intra' ? (
                  <>
                    <td className="py-2 text-right text-ink-600">₹{(lineTax?.cgst ?? 0).toFixed(2)}</td>
                    <td className="py-2 text-right text-ink-600">₹{(lineTax?.sgst ?? 0).toFixed(2)}</td>
                  </>
                ) : taxMode === 'inter' ? (
                  <td className="py-2 text-right text-ink-600">₹{(lineTax?.igst ?? 0).toFixed(2)}</td>
                ) : (
                  <td className="py-2 text-right text-ink-600">₹{(lineTax?.tax ?? 0).toFixed(2)}</td>
                )}
                <td className="py-2 text-right font-medium text-ink-900">₹{line.total.toFixed(2)}</td>
              </tr>
            );
            })}
          </tbody>
          </table>
        </div>

        <p className="mt-2 text-[10px] leading-4 text-ink-400">
          * HSN is from today's catalog, not an order-time snapshot. Per-line GST is estimated from stored
          rates, not an issued tax calculation; it may not reconcile to the stored order tax.
          These amounts must not be used as a tax invoice.
        </p>

        <div className="ml-auto mt-4 w-full max-w-xs space-y-1.5 border-t border-ink-100 pt-4">
          <div className="flex justify-between text-sm text-ink-600">
            <span>Subtotal</span>
            <span>₹{order.subtotal.toFixed(2)}</span>
          </div>
          {taxMode === 'intra' ? (
            <>
              <div className="flex justify-between text-sm text-ink-600">
                <span>Estimated CGST (unverified)</span>
                <span>₹{tax.totals.cgst.toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-sm text-ink-600">
                <span>Estimated SGST (unverified)</span>
                <span>₹{tax.totals.sgst.toFixed(2)}</span>
              </div>
            </>
          ) : taxMode === 'inter' ? (
            <div className="flex justify-between text-sm text-ink-600">
              <span>Estimated IGST (unverified)</span>
              <span>₹{tax.totals.igst.toFixed(2)}</span>
            </div>
          ) : (
            <div className="flex justify-between text-sm text-ink-600">
              <span>Stored order GST (unverified)</span>
              <span>₹{order.gst_total.toFixed(2)}</span>
            </div>
          )}
          {order.discount_total > 0 ? (
            <div className="flex justify-between text-sm text-ink-600">
              <span>Discount</span>
              <span>-₹{order.discount_total.toFixed(2)}</span>
            </div>
          ) : null}
          <div className="flex justify-between border-t border-ink-100 pt-1.5 text-base font-semibold text-ink-950">
            <span>Grand Total</span>
            <span>₹{order.grand_total.toFixed(2)}</span>
          </div>
          <p className="pt-1 text-right text-[10px] text-ink-400">
            Stored order amount only. Recorded GST is not added to the Grand Total.
          </p>
        </div>

        <p className="mt-8 text-center text-xs text-ink-300">
          {ORDER_SUMMARY_NOTICE}
        </p>
      </div>
    </div>
  );
}
