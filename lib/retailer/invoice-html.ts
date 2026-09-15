/**
 * Standalone HTML invoice builder for the DOWNLOAD path
 * (`/retailer/orders/[id]/invoice/download`).
 *
 * The on-screen invoice (app/retailer/orders/[id]/invoice/page.tsx) stays a
 * styled React component with print CSS; this builder renders the SAME data
 * into a self-contained, print-friendly HTML document that a retailer can
 * save and share. It is pure: every amount is passed in already derived from
 * stored order/invoice data — nothing is re-priced here.
 */

import { formatIndiaDateTime } from '@/lib/datetime/india';
import {
  computeInvoiceTaxLines,
  type TaxSplitMode,
} from '@/lib/retailer/invoice-tax';
import type { InvoiceLineForDisplay } from '@/lib/retailer/invoice-display';

function esc(value: string | null | undefined): string {
  return (value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const money = (value: number) => `₹${value.toFixed(2)}`;

export interface StandaloneInvoiceData {
  orderNumber: string;
  placedAt: string;
  company: { name: string; gstin: string; address: string; phone: string };
  billedTo: { shopName: string; address: string; areaName: string; gstin: string };
  lines: InvoiceLineForDisplay[];
  taxMode: TaxSplitMode;
  subtotal: number;
  gstTotal: number;
  discountTotal: number;
  grandTotal: number;
}

export function buildStandaloneInvoiceHtml(data: StandaloneInvoiceData): string {
  const { lines, taxMode } = data;
  const tax = computeInvoiceTaxLines(
    taxMode,
    lines.map((line) => ({ lineKey: line.key, lineTotal: line.total, gstPercent: line.gstPercent }))
  );
  const taxByLine = new Map(tax.lines.map((line) => [line.lineKey, line]));

  const taxHeaders =
    taxMode === 'intra'
      ? '<th>CGST</th><th>SGST</th>'
      : taxMode === 'inter'
        ? '<th>IGST</th>'
        : '<th>GST</th>';

  const rows = lines
    .map((line) => {
      const t = taxByLine.get(line.key);
      const taxCells =
        taxMode === 'intra'
          ? `<td>${money(t?.cgst ?? 0)}</td><td>${money(t?.sgst ?? 0)}</td>`
          : taxMode === 'inter'
            ? `<td>${money(t?.igst ?? 0)}</td>`
            : `<td>${money(t?.tax ?? 0)}</td>`;
      return `<tr>
        <td>${esc(line.displayName)}<div class="muted">${esc(line.packName)}</div></td>
        <td class="mono">${esc(line.hsn ?? '—')}</td>
        <td>${esc(line.quantityLabel)}</td>
        <td>${line.unitPrices.map((p) => `${money(p.price)}<span class="muted"> / ${esc(p.unit)}</span>`).join('<br/>')}</td>
        <td>${line.gstPercent}%</td>
        ${taxCells}
        <td class="strong">${money(line.total)}</td>
      </tr>`;
    })
    .join('\n');

  const taxTotalRows =
    taxMode === 'intra'
      ? `<div class="row"><span>CGST</span><span>${money(tax.totals.cgst)}</span></div>
         <div class="row"><span>SGST</span><span>${money(tax.totals.sgst)}</span></div>`
      : taxMode === 'inter'
        ? `<div class="row"><span>IGST</span><span>${money(tax.totals.igst)}</span></div>`
        : `<div class="row"><span>GST</span><span>${money(data.gstTotal)}</span></div>`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Tax Invoice ${esc(data.orderNumber)} — ${esc(data.company.name)}</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; color: #0f172a; margin: 0; padding: 32px 16px; background: #fff; }
  .invoice { max-width: 820px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 12px; padding: 28px; }
  .head { display: flex; justify-content: space-between; gap: 16px; flex-wrap: wrap; border-bottom: 1px solid #e2e8f0; padding-bottom: 16px; }
  .muted { color: #64748b; font-size: 12px; }
  .mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
  .strong { font-weight: 600; }
  .title { color: #e11d48; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; font-size: 13px; }
  .billed { margin-top: 16px; border-bottom: 1px solid #e2e8f0; padding-bottom: 16px; font-size: 13px; }
  table { width: 100%; border-collapse: collapse; margin-top: 16px; font-size: 13px; }
  th, td { text-align: left; padding: 8px 6px; border-bottom: 1px solid #f1f5f9; vertical-align: top; }
  th { font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; color: #94a3b8; }
  td:nth-child(n+4), th:nth-child(n+4) { text-align: right; }
  .totals { max-width: 320px; margin-left: auto; margin-top: 16px; }
  .totals .row { display: flex; justify-content: space-between; font-size: 13px; color: #334155; padding: 3px 0; }
  .totals .grand { border-top: 1px solid #e2e8f0; margin-top: 8px; padding-top: 8px; font-size: 16px; font-weight: 700; color: #0f172a; }
  .note { margin-top: 20px; font-size: 11px; color: #94a3b8; text-align: center; }
  @media print { body { padding: 0; } .invoice { border: 0; padding: 0; } }
</style>
</head>
<body>
  <div class="invoice">
    <div class="head">
      <div>
        <p class="strong" style="font-size:16px;margin:0 0 4px">${esc(data.company.name)}</p>
        <p class="muted" style="margin:0">${esc(data.company.address)}</p>
        <p class="muted" style="margin:2px 0 0">GSTIN: ${esc(data.company.gstin)}</p>
        <p class="muted" style="margin:2px 0 0">${esc(data.company.phone)}</p>
      </div>
      <div style="text-align:right">
        <p class="title">Tax Invoice</p>
        <p class="mono strong" style="margin:4px 0">${esc(data.orderNumber)}</p>
        <p class="muted" style="margin:0">${esc(formatIndiaDateTime(data.placedAt))}</p>
      </div>
    </div>

    <div class="billed">
      <p class="muted" style="margin:0 0 4px;text-transform:uppercase;font-size:11px;letter-spacing:0.05em">Billed to</p>
      <p class="strong" style="margin:0">${esc(data.billedTo.shopName)}</p>
      <p class="muted" style="margin:2px 0 0">${esc(data.billedTo.address)}</p>
      ${data.billedTo.areaName ? `<p class="muted" style="margin:2px 0 0">${esc(data.billedTo.areaName)}</p>` : ''}
      ${data.billedTo.gstin ? `<p class="muted" style="margin:2px 0 0">GSTIN: ${esc(data.billedTo.gstin)}</p>` : ''}
    </div>

    <table>
      <thead>
        <tr><th>Item</th><th>HSN</th><th>Qty</th><th>Unit Price</th><th>GST %</th>${taxHeaders}<th>Total</th></tr>
      </thead>
      <tbody>
        ${rows}
      </tbody>
    </table>
    <p class="muted" style="font-size:11px;margin-top:8px">
      Rates are GST-inclusive; the tax columns above are the tax components already contained in each line total.
    </p>

    <div class="totals">
      <div class="row"><span>Subtotal</span><span>${money(data.subtotal)}</span></div>
      ${taxTotalRows}
      ${data.discountTotal > 0 ? `<div class="row"><span>Discount</span><span>-${money(data.discountTotal)}</span></div>` : ''}
      <div class="row grand"><span>Grand Total</span><span>${money(data.grandTotal)}</span></div>
    </div>

    <p class="note">This is a computer-generated invoice for ${esc(data.company.name)} — ${esc(data.orderNumber)}.</p>
  </div>
</body>
</html>`;
}
