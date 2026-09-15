/**
 * Shared display shape for GST invoice lines — used by BOTH the on-screen
 * invoice page and the standalone download HTML so the two can never drift
 * apart. Pure mapping over the grouped, stored order lines; it labels and
 * organises data, it never prices anything.
 */

import {
  formatQuantitySummary,
  groupOrderLines,
  rowUnit,
  type GroupedOrderLine,
  type OrderItemUnit,
} from '@/lib/orders/item-display';
import { buildCanonicalProductName } from '@/lib/retailer/product-name';

/**
 * The minimum stored-row shape an invoice line is folded from. Kept structural
 * (not the page's wider interface) so the mapper stays reusable.
 */
export interface InvoiceOrderItemRow {
  id: string;
  product_id: string;
  pack_id: string | null;
  quantity: number;
  quantity_unit: OrderItemUnit | null;
  quantity_pieces: number | null;
  units_per_case: number | null;
  unit_price: number;
  gst_percent: number;
  line_total: number;
  products: { name: string; hsn_code: string | null; brands: { name: string } | null } | null;
  product_packs: { pack_name: string; units_per_case: number } | null;
}

export interface InvoiceLineForDisplay {
  /** Stable key for React + the tax map (pack id fallback: row id). */
  key: string;
  displayName: string;
  packName: string;
  hsn: string | null;
  quantityLabel: string;
  /** One entry per billed unit, e.g. [ {price, unit:'pc'} ] or cases+loose. */
  unitPrices: { price: number; unit: 'pc' | 'case' }[];
  gstPercent: number;
  /** Σ stored line_totals — the exact billed amount for the line. */
  total: number;
}

export function toInvoiceDisplayLines(rows: InvoiceOrderItemRow[]): InvoiceLineForDisplay[] {
  const grouped: GroupedOrderLine<InvoiceOrderItemRow>[] = groupOrderLines(rows);
  return grouped.map((line) => {
    const { first } = line;
    const canonical = buildCanonicalProductName({
      brandName: first.products?.brands?.name ?? null,
      productName: first.products?.name ?? null,
      packName: first.product_packs?.pack_name ?? null,
    });
    const unitPrices = line.rows
      .filter((row, index, all) => all.findIndex((other) => other.unit_price === row.unit_price && rowUnit(other) === rowUnit(row)) === index)
      .map((row) => ({
        price: row.unit_price,
        unit: (rowUnit(row) === 'pieces' ? 'pc' : 'case') as 'pc' | 'case',
      }));
    return {
      key: line.key,
      displayName: canonical,
      packName: first.product_packs?.pack_name ?? 'Pack',
      hsn: first.products?.hsn_code ?? null,
      quantityLabel: formatQuantitySummary(line.quantity),
      unitPrices,
      gstPercent: first.gst_percent,
      total: line.total,
    };
  });
}
