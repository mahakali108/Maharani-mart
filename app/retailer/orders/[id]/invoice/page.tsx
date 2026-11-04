import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Download } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { requireUser } from '@/lib/auth/session';
import { PrintButton } from '@/components/retailer/print-button';
import { formatIndiaDateTime } from '@/lib/datetime/india';
import { classifyTaxSplit, computeInvoiceTaxLines } from '@/lib/retailer/invoice-tax';
import { toInvoiceDisplayLines, type InvoiceOrderItemRow } from '@/lib/retailer/invoice-display';
import { getTaxInvoiceReadiness } from '@/lib/retailer/tax-invoice-readiness';

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

export default async function InvoicePage({ params: paramsPromise }: { params: Promise<{ id: string }> }) {
  const params = await paramsPromise;
  const user = await requireUser();
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

  if (!order) notFound();

  const items = (itemData ?? []) as unknown as (InvoiceOrderItemRow & { source_type?: 'maharani' | 'seller' | null })[];
  const lines = toInvoiceDisplayLines(items);
  const issuance = getTaxInvoiceReadiness({
    hasMarketplaceSellerLine: items.some((item) => item.source_type === 'seller'),
  });

  // Preserve the order and its stored accounting rows, but do not render a
  // misleading tax document without issuer facts or for a marketplace order
  // whose seller-of-record model has not received CA approval.
  if (!issuance.ready) {
    return (
      <div className="mx-auto max-w-2xl space-y-6">
        <div className="shop-intro">
          <p className="shop-eyebrow">Order documents</p>
          <h1 className="shop-heading mt-1">Tax invoice unavailable</h1>
          <Link href={`/retailer/orders/${order.id}`} className="mt-2 inline-flex min-h-10 items-center text-xs underline underline-offset-4">Back to order</Link>
        </div>
        <section className="rounded-2xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-950">
          <p className="font-semibold">A tax invoice is not being generated for this order.</p>
          <p className="mt-2 text-xs leading-5">{issuance.message}</p>
          <p className="mt-2 text-xs leading-5">The underlying order and recorded amounts are preserved. Please contact the business for the approved invoice process.</p>
        </section>
      </div>
    );
  }
  const company = issuance.issuer;

  /*
   * CGST/SGST vs IGST is decided ONLY from a configured, syntactically valid
   * issuer GSTIN and the retailer GSTIN. It is a display calculation, not a
   * GST-registration or place-of-supply determination.
   */
  const taxMode = classifyTaxSplit(company.gstin, retailer?.gstin ?? null);
  const tax = computeInvoiceTaxLines(
    taxMode,
    lines.map((line) => ({ lineKey: line.key, lineTotal: line.total, gstPercent: line.gstPercent }))
  );
  const taxByLine = new Map(tax.lines.map((line) => [line.lineKey, line]));

  return (
    <div className="mx-auto max-w-2xl space-y-6 print:max-w-none">
      <div className="shop-intro flex flex-wrap items-center justify-between gap-3 print:hidden">
        <div className="shop-intro">
          <p className="shop-eyebrow">Order documents</p><h1 className="shop-heading mt-1">Tax invoice</h1><Link href={`/retailer/orders/${order.id}`} className="mt-2 inline-flex min-h-10 items-center text-xs underline underline-offset-4">Back to order</Link></div>
        <div className="flex gap-2">
        <Link
          href={`/retailer/orders/${order.id}/invoice/download`}
          className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-xs font-semibold text-ink-700 transition hover:border-primary-300 hover:text-primary-700"
        >
          <Download className="h-4 w-4" />
          Download
        </Link>
        <PrintButton />
        </div>
      </div>

      <div className="rounded-2xl border border-ink-100 bg-white p-6 print:rounded-none print:border-0 print:p-0 sm:p-8">
        <div className="flex min-w-0 flex-wrap items-start justify-between gap-3 border-b border-ink-100 pb-4">
          <div className="min-w-0 flex-1">
            <p className="break-words text-lg font-semibold text-ink-950">{company.name}</p>
            <p className="break-words text-xs text-ink-500">{company.address}</p>
            <p className="break-words text-xs text-ink-500">GSTIN: {company.gstin}</p>
            <p className="break-words text-xs text-ink-500">{company.phone}</p>
          </div>
          <div className="min-w-0 shrink-0 text-right">
            <p className="text-sm font-semibold uppercase tracking-wide text-primary-600">Tax Invoice</p>
            <p className="break-all font-mono text-sm text-ink-900">{order.order_number}</p>
            <p className="break-words text-xs text-ink-500">
              {formatIndiaDateTime(order.placed_at)}
            </p>
          </div>
        </div>

        <div className="mt-4 min-w-0 border-b border-ink-100 pb-4">
          <p className="text-xs font-medium uppercase tracking-wide text-ink-400">Billed to</p>
          <p className="mt-1 break-words text-sm font-semibold text-ink-900">{retailer?.shop_name}</p>
          <p className="break-words text-xs text-ink-500">{retailer?.address ?? '—'}</p>
          {retailer?.areas?.name ? <p className="break-words text-xs text-ink-500">{retailer.areas.name}</p> : null}
          {retailer?.gstin ? <p className="break-words text-xs text-ink-500">GSTIN: {retailer.gstin}</p> : null}
        </div>

        {/* On phones the line-item table scrolls inside its own container so the
            page never grows wider than the screen; print output is unchanged. */}
        <div className="table-scroll mt-4 print:overflow-visible">
          <table className="w-full min-w-[560px] text-sm print:min-w-0">
          <thead>
            <tr className="border-b border-ink-100 text-left text-xs uppercase tracking-wide text-ink-400">
              <th className="py-2 pr-3 font-medium">Item</th>
              <th className="py-2 pr-3 font-medium">HSN</th>
              <th className="py-2 pr-3 font-medium">Qty</th>
              <th className="py-2 pl-3 text-right font-medium">Unit Price</th>
              <th className="py-2 pl-3 text-right font-medium">GST %</th>
              {taxMode === 'intra' ? (
                <>
                  <th className="py-2 pl-3 text-right font-medium">CGST</th>
                  <th className="py-2 pl-3 text-right font-medium">SGST</th>
                </>
              ) : taxMode === 'inter' ? (
                <th className="py-2 pl-3 text-right font-medium">IGST</th>
              ) : (
                <th className="py-2 pl-3 text-right font-medium">GST</th>
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
          Each line is billed per piece at the retail piece rate shown. Rates are GST-inclusive, and the tax
          column{taxMode === 'intra' ? 's (CGST + SGST)' : ''} above is already contained in the line total.
        </p>

        <div className="ml-auto mt-4 w-full max-w-xs space-y-1.5 border-t border-ink-100 pt-4">
          <div className="flex justify-between text-sm text-ink-600">
            <span>Subtotal</span>
            <span>₹{order.subtotal.toFixed(2)}</span>
          </div>
          {taxMode === 'intra' ? (
            <>
              <div className="flex justify-between text-sm text-ink-600">
                <span>CGST</span>
                <span>₹{tax.totals.cgst.toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-sm text-ink-600">
                <span>SGST</span>
                <span>₹{tax.totals.sgst.toFixed(2)}</span>
              </div>
            </>
          ) : taxMode === 'inter' ? (
            <div className="flex justify-between text-sm text-ink-600">
              <span>IGST</span>
              <span>₹{tax.totals.igst.toFixed(2)}</span>
            </div>
          ) : (
            <div className="flex justify-between text-sm text-ink-600">
              <span>GST</span>
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
            All prices are GST-inclusive — the tax components above are already contained in the Grand Total.
          </p>
        </div>

        <p className="mt-8 text-center text-xs text-ink-300">
          This is a computer-generated invoice for {company.name}.
        </p>
      </div>
    </div>
  );
}
