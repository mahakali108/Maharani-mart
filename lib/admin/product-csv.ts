/**
 * Catalog CSV import/export — parsing, validation and reporting.
 *
 * WHY A SEPARATE MODULE
 * ---------------------
 * `lib/admin/csv.ts` only ever WROTE CSV (retailer statement, delivered-order
 * and inventory exports). Import needs the other direction, and importing
 * untrusted text into the catalog is where a validation gap actually costs
 * money: a mistyped GST rate ends up on a tax invoice, a mistyped barcode never
 * scans, and a duplicated EAN breaks the unique index.
 *
 * Row validation here calls the SAME `validateProductDraft` the product form
 * uses, so a value that is legal in the form is legal in an import. There is no
 * second copy of the rules.
 *
 * PURE — no Supabase, no `next/*`, no env, no secrets. The Route Handler and
 * the Server Action do the I/O and the id resolution; this file decides what a
 * row means and whether it is acceptable.
 *
 * WHAT IS DELIBERATELY NOT SUPPORTED
 * ----------------------------------
 * SKU codes. Migration 0023 removed `products.sku_code` from the workflow: it
 * is nullable, auto-generated and never shown to a user. A "SKU" column in a
 * template would be a field the app cannot display, edit or search — so it is
 * not offered, and a submitted `sku_code` header is reported as unknown rather
 * than silently ignored. The internal pack code (`product_packs.pack_sku_code`)
 * is generated per pack for the same reason.
 */

import {
  derivedPiecePrice,
  validateBarcode,
  validateHsnCode,
  validateProductDraft,
  type FieldErrors,
  type ValidatedProduct,
} from '@/lib/admin/catalog-validation';

/**
 * Columns the importer understands, in template order.
 *
 * `brand` and `category` are NAMES, not ids — an operator building a sheet in
 * Excel does not have UUIDs to hand. The Server Action resolves names to ids
 * against the live tables and reports the rows whose name matched nothing.
 *
 * UNIT CONVENTION (matters — getting it wrong costs real money):
 *   `mrp` and `cost_price` are PER PIECE, matching the existing product form
 *   ("MRP (₹) per piece"). `case_price` is the GST-INCLUSIVE price of ONE FULL
 *   CASE, matching `product_packs.case_price` (0022). The per-piece selling
 *   price is always derived (case_price / units_per_case) and is never stored,
 *   so the template deliberately has no per-piece selling column.
 */
export const PRODUCT_CSV_COLUMNS = [
  'name',
  'brand',
  'category',
  'unit',
  'units_per_case',
  'mrp',
  'case_price',
  'cost_price',
  'gst_percent',
  'hsn_code',
  'barcode',
  'lead_time_days',
  'moq',
  'is_new_launch',
] as const;

export type ProductCsvColumn = (typeof PRODUCT_CSV_COLUMNS)[number];

/** Header aliases an operator is likely to type. Matched case-insensitively. */
const HEADER_ALIASES: Record<string, ProductCsvColumn> = {
  name: 'name',
  product: 'name',
  product_name: 'name',
  brand: 'brand',
  brand_name: 'brand',
  category: 'category',
  category_name: 'category',
  unit: 'unit',
  uom: 'unit',
  units_per_case: 'units_per_case',
  pieces_per_case: 'units_per_case',
  pcs_per_case: 'units_per_case',
  mrp: 'mrp',
  base_price: 'mrp',
  case_price: 'case_price',
  case_selling_price: 'case_price',
  cost_price: 'cost_price',
  cost: 'cost_price',
  purchase_cost: 'cost_price',
  gst_percent: 'gst_percent',
  gst: 'gst_percent',
  gst_rate: 'gst_percent',
  hsn_code: 'hsn_code',
  hsn: 'hsn_code',
  barcode: 'barcode',
  ean: 'barcode',
  upc: 'barcode',
  lead_time_days: 'lead_time_days',
  lead_time: 'lead_time_days',
  moq: 'moq',
  min_order_qty: 'moq',
  is_new_launch: 'is_new_launch',
  new_launch: 'is_new_launch',
};

/**
 * Fold a header label onto an alias key: lowercase, every run of
 * non-alphanumerics becomes a single underscore, and edge underscores are
 * dropped. So "GST %", "gst%" and "GST" all land on `gst`.
 */
function normalizeHeader(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/**
 * Parse a CSV document into rows of cells.
 *
 * Handles the parts of RFC 4180 that actually appear in Excel/Sheets exports:
 * quoted fields, embedded commas, embedded newlines inside quotes, doubled
 * quotes as an escaped quote, CRLF and LF line endings, and a leading UTF-8
 * byte-order mark.
 */
export function parseCsv(text: string): string[][] {
  const input = text.replace(/^\uFEFF/, '');
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index] as string;

    if (quoted) {
      if (char === '"') {
        if (input[index + 1] === '"') {
          cell += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        cell += char;
      }
      continue;
    }

    if (char === '"') {
      quoted = true;
    } else if (char === ',') {
      row.push(cell);
      cell = '';
    } else if (char === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else if (char !== '\r') {
      cell += char;
    }
  }

  // Flush the final cell/row (a file with no trailing newline).
  if (cell !== '' || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }

  return rows;
}

/** Strip a trailing comma-separated run of empty cells, so `a,b,,` == `a,b`. */
function trimTrailingEmpty(cells: string[]): string[] {
  const copy = [...cells];
  while (copy.length > 0 && copy[copy.length - 1]!.trim() === '') copy.pop();
  return copy;
}

export interface CsvHeaderResult {
  /** Positional map: cell index → recognised column, or null when unrecognised. */
  mapping: (ProductCsvColumn | null)[];
  /** Raw header labels the importer did not recognise. */
  unknownHeaders: string[];
  /** Recognised columns, in template order, for the preview header row. */
  columns: ProductCsvColumn[];
}

/** Map a header row onto known columns. Unknown labels are reported, never dropped quietly. */
export function mapCsvHeader(headerRow: string[]): CsvHeaderResult {
  const mapping: (ProductCsvColumn | null)[] = [];
  const unknownHeaders: string[] = [];
  const seen = new Set<ProductCsvColumn>();

  for (const raw of headerRow) {
    const label = raw.trim();
    const column = label ? HEADER_ALIASES[normalizeHeader(label)] : undefined;
    if (!column) {
      if (label) unknownHeaders.push(label);
      mapping.push(null);
      continue;
    }
    // A duplicated column is ambiguous — take the first, flag the rest.
    if (seen.has(column)) {
      unknownHeaders.push(`${label} (duplicate of an earlier column)`);
      mapping.push(null);
      continue;
    }
    seen.add(column);
    mapping.push(column);
  }

  const columns = PRODUCT_CSV_COLUMNS.filter((column) => seen.has(column));
  return { mapping, unknownHeaders, columns };
}

/** Build a cell record from a data row using the header mapping. */
export function rowToRecord(row: string[], mapping: (ProductCsvColumn | null)[]): Record<ProductCsvColumn, string> {
  const record = {} as Record<ProductCsvColumn, string>;
  for (const column of PRODUCT_CSV_COLUMNS) record[column] = '';
  mapping.forEach((column, index) => {
    if (!column) return;
    record[column] = (row[index] ?? '').trim();
  });
  return record;
}

/**
 * Validate the whole file.
 *
 * Row numbers in the report are 1-based DATA rows (the header is row 0 and is
 * never reported as an error), plus 1 for humans reading the sheet — see
 * `rowNumber` on each result, which is the spreadsheet line number.
 */
export interface CsvRowIssue {
  /** Spreadsheet line number (header = 1, first data row = 2). */
  rowNumber: number;
  field: keyof FieldErrors | 'brand' | 'category' | 'duplicate';
  message: string;
}

export interface ParsedProductRow {
  rowNumber: number;
  record: Record<ProductCsvColumn, string>;
  /** Present only when the row itself is valid; brand/category ids resolve later. */
  value: ValidatedProduct | null;
  brandName: string;
  categoryName: string;
  isNewLaunch: boolean;
  issues: CsvRowIssue[];
}

export interface CsvParseReport {
  header: CsvHeaderResult | null;
  rows: ParsedProductRow[];
  /** File-level problems that stop the import before any row is considered. */
  fatalErrors: string[];
  validCount: number;
  invalidCount: number;
}

/** Hard ceiling so a multi-megabyte upload cannot be parsed into memory. */
export const MAX_IMPORT_ROWS = 2000;

function parseBooleanFlag(raw: string): boolean {
  const value = raw.trim().toLowerCase();
  return ['1', 'true', 'yes', 'y', 'new', 'on'].includes(value);
}

export function analyzeProductCsv(text: string): CsvParseReport {
  const fatalErrors: string[] = [];
  const rows: ParsedProductRow[] = [];

  if (text.trim() === '') {
    return { header: null, rows: [], fatalErrors: ['The file is empty.'], validCount: 0, invalidCount: 0 };
  }

  const parsed = parseCsv(text);
  const headerCells = trimTrailingEmpty(parsed[0] ?? []);
  if (headerCells.length === 0) {
    return { header: null, rows: [], fatalErrors: ['The file has no header row.'], validCount: 0, invalidCount: 0 };
  }

  const header = mapCsvHeader(headerCells);
  if (!header.columns.includes('name')) {
    fatalErrors.push('The file must have a "name" column.');
  }
  if (!header.columns.includes('case_price')) {
    fatalErrors.push('The file must have a "case_price" column.');
  }
  for (const unknown of header.unknownHeaders) {
    fatalErrors.push(`Unknown column "${unknown}" — it would be ignored, so remove it or rename it.`);
  }
  if (fatalErrors.length > 0) {
    return { header, rows: [], fatalErrors, validCount: 0, invalidCount: 0 };
  }

  const dataRows = parsed.slice(1).filter((row) => trimTrailingEmpty(row).some((cell) => cell.trim() !== ''));
  if (dataRows.length === 0) {
    return { header, rows: [], fatalErrors: ['The file has a header but no product rows.'], validCount: 0, invalidCount: 0 };
  }
  if (dataRows.length > MAX_IMPORT_ROWS) {
    fatalErrors.push(
      `This file has ${dataRows.length} rows; the limit is ${MAX_IMPORT_ROWS}. Split it into smaller files.`
    );
    return { header, rows: [], fatalErrors, validCount: 0, invalidCount: 0 };
  }

  // Barcodes must be unique across the whole catalog AND within the file; the
  // in-file check runs here because two rows with the same EAN would otherwise
  // both pass and the second would fail on the unique index mid-import.
  const barcodesSeen = new Map<string, number>();

  dataRows.forEach((row, index) => {
    const rowNumber = index + 2;
    const record = rowToRecord(row, header.mapping);
    const issues: CsvRowIssue[] = [];

    const result = validateProductDraft({
      name: record.name,
      unit: record.unit,
      unitsPerCase: record.units_per_case || 1,
      mrp: record.mrp,
      casePrice: record.case_price,
      costPrice: record.cost_price,
      gstPercent: record.gst_percent || 0,
      hsnCode: record.hsn_code,
      barcode: record.barcode,
      leadTimeDays: record.lead_time_days || 2,
      moq: record.moq || 1,
    });

    if (!result.ok) {
      for (const [field, message] of Object.entries(result.errors)) {
        if (message) issues.push({ rowNumber, field: field as CsvRowIssue['field'], message });
      }
    } else if (result.value.barcode) {
      const previous = barcodesSeen.get(result.value.barcode);
      if (previous !== undefined) {
        issues.push({
          rowNumber,
          field: 'duplicate',
          message: `Barcode ${result.value.barcode} is repeated — it also appears on row ${previous}.`,
        });
      } else {
        barcodesSeen.set(result.value.barcode, rowNumber);
      }
    }

    rows.push({
      rowNumber,
      record,
      value: result.ok ? result.value : null,
      brandName: record.brand.trim(),
      categoryName: record.category.trim(),
      isNewLaunch: parseBooleanFlag(record.is_new_launch),
      issues,
    });
  });

  const validCount = rows.filter((row) => row.issues.length === 0).length;
  return { header, rows, fatalErrors, validCount, invalidCount: rows.length - validCount };
}

// ----------------------------------------------------------------------------
// Template + export
// ----------------------------------------------------------------------------

/** One example row per column, so the downloaded template is self-documenting. */
export function productCsvTemplateRows(): (string | number)[][] {
  return [
    [
      'Example Tea Gold 1kg',
      'Example Brand',
      'Beverages',
      'box',
      12,
      620,
      6600,
      480,
      5,
      '09023010',
      '8901234567890',
      3,
      12,
      'yes',
    ],
  ];
}

/** The header + example row, ready to stream as a download. */
export function productCsvTemplate(): string[][] {
  return [[...PRODUCT_CSV_COLUMNS], ...productCsvTemplateRows().map((row) => row.map(String))];
}

/** A row of the filtered/selected export, in template column order. */
export interface ProductExportRow {
  name: string;
  brandName: string | null;
  categoryName: string | null;
  unit: string;
  unitsPerCase: number;
  mrp: number;
  casePrice: number | null;
  costPrice: number | null;
  gstPercent: number;
  hsnCode: string | null;
  barcode: string | null;
  leadTimeDays: number;
  moq: number;
  isNewLaunch: boolean;
  stockStatus: string | null;
  availableStock: number | null;
}

/** Export header: template columns plus the read-only stock context. */
export const PRODUCT_EXPORT_HEADER: string[] = [
  ...PRODUCT_CSV_COLUMNS,
  'stock_status',
  'available_stock',
];

export function productExportCells(row: ProductExportRow): (string | number | boolean | null)[] {
  return [
    row.name,
    row.brandName,
    row.categoryName,
    row.unit,
    row.unitsPerCase,
    row.mrp,
    row.casePrice,
    row.costPrice,
    row.gstPercent,
    row.hsnCode,
    row.barcode,
    row.leadTimeDays,
    row.moq,
    row.isNewLaunch,
    row.stockStatus,
    row.availableStock,
  ];
}

/**
 * Human-readable summary of what an import did.
 * Nothing is silently skipped: the counts always add up to the row count.
 */
export function describeImportResult(input: {
  attempted: number;
  imported: number;
  skipped: number;
  failedRows: { rowNumber: number; message: string }[];
}): string {
  const parts = [`${input.imported} of ${input.attempted} row(s) imported.`];
  if (input.skipped > 0) parts.push(`${input.skipped} skipped.`);
  if (input.failedRows.length > 0) {
    const listed = input.failedRows
      .slice(0, 8)
      .map((row) => `row ${row.rowNumber}: ${row.message}`)
      .join('; ');
    const more = input.failedRows.length > 8 ? ` (+${input.failedRows.length - 8} more)` : '';
    parts.push(`Failed — ${listed}${more}`);
  }
  return parts.join(' ');
}

/** Per-piece selling price derived from a case price, for the import preview. */
export { derivedPiecePrice };
export { validateBarcode, validateHsnCode };
