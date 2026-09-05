import { round2 } from '@/lib/retailer/case-pricing';

/**
 * Reading persisted order lines back.
 *
 * `order_items` rows are written by `lib/orders/create-order.ts` from the
 * canonical engine, one row per pricing unit:
 *
 *   quantity_unit = 'cases'  → `quantity` whole cases at `unit_price` per case
 *   quantity_unit = 'pieces' → `quantity` loose pieces at `unit_price` per piece
 *   quantity_unit = null     → historical line, written before the case/loose
 *                              split, where `quantity` already meant packs
 *                              (i.e. cases) of `units_per_case`
 *
 * so `unit_price × quantity = line_total` holds exactly on every row and the
 * order header totals are just the sum of the rows. `quantity_pieces` is a
 * snapshot of how many individual pieces the row covers, which is what
 * invoices, reorders and dispatch lists should count.
 *
 * This module is presentation math only — it never prices anything and holds no
 * server-only import, so every role's order page (retailer, admin, staff,
 * salesman) and the AI tools can share one interpretation of a line.
 */

/**
 * How a persisted row's `quantity` must be read. `'packs'` is the value legacy
 * rows carry (written by 0026's column default) and behaves exactly like
 * `'cases'`; new orders are written as `'cases'` / `'pieces'` by the quote.
 */
export type OrderItemUnit = 'packs' | 'cases' | 'pieces';

export interface OrderItemQuantityRow {
  quantity: number;
  quantity_unit?: OrderItemUnit | null;
  quantity_pieces?: number | null;
  units_per_case?: number | null;
}

/** 'cases' for a whole-case row (including historical pack rows), else 'pieces'. */
export function rowUnit(row: OrderItemQuantityRow): Exclude<OrderItemUnit, 'packs'> {
  return row.quantity_unit === 'pieces' ? 'pieces' : 'cases';
}

/** How many cases a row represents (0 for a loose-piece row). */
export function rowCases(row: OrderItemQuantityRow): number {
  return rowUnit(row) === 'cases' ? row.quantity : 0;
}

/** How many loose pieces a row represents (its own quantity for a pieces row). */
export function rowLoosePieces(row: OrderItemQuantityRow): number {
  return rowUnit(row) === 'pieces' ? row.quantity : 0;
}

/** Individual pieces covered by a row — the snapshot when present, else derived. */
export function rowPieces(row: OrderItemQuantityRow): number {
  if (typeof row.quantity_pieces === 'number' && row.quantity_pieces > 0) return row.quantity_pieces;
  const units = row.units_per_case && row.units_per_case >= 1 ? row.units_per_case : 1;
  return rowUnit(row) === 'pieces' ? row.quantity : row.quantity * units;
}

export interface QuantitySummary {
  /** Total pieces on the line(s). */
  pieces: number;
  /** Whole cases billed at the case price. */
  cases: number;
  /** Loose pieces billed at their tier price. */
  loose: number;
  /** Pack size the line(s) were billed against, when known. */
  unitsPerCase: number | null;
}

/** Collapse the rows of one line (same pack) into Cases / Loose / pieces counts. */
export function summarizeQuantityRows(rows: OrderItemQuantityRow[]): QuantitySummary {
  let pieces = 0;
  let cases = 0;
  let loose = 0;
  let unitsPerCase: number | null = null;
  for (const row of rows) {
    pieces += rowPieces(row);
    cases += rowCases(row);
    loose += rowLoosePieces(row);
    if (unitsPerCase === null && typeof row.units_per_case === 'number' && row.units_per_case >= 1) {
      unitsPerCase = row.units_per_case;
    }
  }
  return { pieces, cases, loose, unitsPerCase };
}

/**
 * "Qty 46 pcs — 1 Case × 40 + 6 loose" style label used on order detail pages
 * and invoices. Falls back to the plain piece count when the pack size is
 * unknown, and to "1 pc" for single-piece lines.
 */
export function formatQuantitySummary(summary: QuantitySummary): string {
  const { pieces, cases, loose } = summary;
  const base = `${pieces} pc${pieces === 1 ? '' : 's'}`;
  // Retailer model: pieces only. A line with no case component is reported as a
  // plain piece count — no "loose" qualifier is needed and none is shown.
  if (cases === 0) return base;
  // Historical mixed rows (billed before the piece-only model) still describe
  // their case + loose split so the past order renders the numbers it was
  // written with.
  const parts: string[] = [];
  if (cases > 0) parts.push(`${cases} Case${cases === 1 ? '' : 's'}`);
  if (loose > 0) parts.push(`${loose} loose pc${loose === 1 ? '' : 's'}`);
  return `${base} (${parts.join(' + ')})`;
}

/** The row-level quantity label, e.g. "6 pcs" or (historical) "1 Case". */
export function formatRowQuantity(row: OrderItemQuantityRow): string {
  return rowUnit(row) === 'pieces'
    ? `${row.quantity} pc${row.quantity === 1 ? '' : 's'}`
    : `${row.quantity} Case${row.quantity === 1 ? '' : 's'}`;
}

/** Minimal identity a persisted line needs to be folded back into one view row. */
export interface GroupableOrderItemRow extends OrderItemQuantityRow {
  id?: string;
  product_id?: string | null;
  pack_id?: string | null;
  line_total?: number;
}

export interface GroupedOrderLine<T extends GroupableOrderItemRow> {
  key: string;
  first: T;
  rows: T[];
  quantity: QuantitySummary;
  /** Σ of the member rows' money — never recomputed from a blended rate. */
  total: number;
}

/**
 * Fold stored `order_items` rows back into one entry per ordered pack: a mixed
 * purchase is written as a cases row plus a loose-pieces row, and every screen
 * (retailer order, admin order, invoice, AI tools) shows them together while
 * each price part stays printed exactly as it was billed.
 */
export function groupOrderLines<T extends GroupableOrderItemRow>(rows: T[]): GroupedOrderLine<T>[] {
  const groups = new Map<string, T[]>();
  for (const row of rows) {
    // Single-row lines fall back to the row id, which keeps the React key stable.
    const key = row.pack_id ?? row.product_id ?? `row:${row.id}`;
    const bucket = groups.get(key);
    if (bucket) bucket.push(row);
    else groups.set(key, [row]);
  }

  const lines: GroupedOrderLine<T>[] = [];
  for (const [key, members] of groups) {
    const first = members[0];
    if (!first) continue;
    lines.push({
      key,
      first,
      rows: members,
      quantity: summarizeQuantityRows(members),
      total: sumLineTotals(members),
    });
  }
  return lines;
}

/**
 * Σ `line_total` of the member rows, rounded once with the same paise rounding
 * the pricing engine uses. The total of a folded line is always the sum of its
 * stored rows — never a re-derived blended rate.
 */
export function sumLineTotals(rows: readonly { line_total?: number }[]): number {
  return round2(rows.reduce((sum, row) => sum + (row.line_total ?? 0), 0));
}
