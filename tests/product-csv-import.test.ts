import { describe, expect, it } from 'vitest';
import {
  MAX_IMPORT_ROWS,
  PRODUCT_CSV_COLUMNS,
  PRODUCT_EXPORT_HEADER,
  analyzeProductCsv,
  describeImportResult,
  mapCsvHeader,
  parseCsv,
  productCsvTemplate,
  productExportCells,
  rowToRecord,
} from '@/lib/admin/product-csv';

const HEADER = PRODUCT_CSV_COLUMNS.join(',');

function csv(...rows: string[][]): string {
  return [PRODUCT_CSV_COLUMNS, ...rows].map((row) => row.join(',')).join('\n');
}

const goodRow = [
  'Tata Tea Gold 1kg',
  'Tata',
  'Beverages',
  'box',
  '12',
  '620',
  '6600',
  '480',
  '5',
  '09023010',
  '8901234567890',
  '3',
  '12',
  'yes',
];

/** Override one named column of the known-good row, so each test changes one thing. */
function override(column: (typeof PRODUCT_CSV_COLUMNS)[number], value: string): string[] {
  const index = PRODUCT_CSV_COLUMNS.indexOf(column);
  const copy = [...goodRow];
  copy[index] = value;
  return copy;
}

describe('CSV parsing (RFC 4180)', () => {
  it('parses a simple document', () => {
    expect(parseCsv('a,b\n1,2')).toEqual([['a', 'b'], ['1', '2']]);
  });

  it('handles quoted cells containing commas and newlines', () => {
    expect(parseCsv('"a,b","line1\nline2"')).toEqual([['a,b', 'line1\nline2']]);
  });

  it('unescapes doubled quotes', () => {
    expect(parseCsv('"say ""hi"""')).toEqual([['say "hi"']]);
  });

  it('handles CRLF line endings and a UTF-8 BOM', () => {
    expect(parseCsv('\uFEFFa,b\r\n1,2\r\n')).toEqual([['a', 'b'], ['1', '2']]);
  });

  it('keeps a final row without a trailing newline', () => {
    expect(parseCsv('a\n1')).toEqual([['a'], ['1']]);
  });

  it('returns nothing for an empty document', () => {
    expect(parseCsv('')).toEqual([]);
  });
});

describe('header mapping', () => {
  it('recognises the template columns', () => {
    const result = mapCsvHeader([...PRODUCT_CSV_COLUMNS]);
    expect(result.unknownHeaders).toEqual([]);
    expect(result.columns).toEqual([...PRODUCT_CSV_COLUMNS]);
  });

  it('accepts common aliases and is case/space insensitive', () => {
    const result = mapCsvHeader(['Product Name', 'GST %', 'EAN', 'MOQ', 'UOM']);
    expect(result.columns).toContain('name');
    expect(result.columns).toContain('gst_percent');
    expect(result.columns).toContain('barcode');
    expect(result.columns).toContain('moq');
    expect(result.columns).toContain('unit');
    expect(result.unknownHeaders).toEqual([]);
  });

  it('reports unknown headers instead of dropping them silently', () => {
    const result = mapCsvHeader(['name', 'supplier', 'manufacturer']);
    expect(result.unknownHeaders).toEqual(['supplier', 'manufacturer']);
  });

  it('flags a duplicated column as ambiguous', () => {
    const result = mapCsvHeader(['name', 'gst', 'gst_rate']);
    expect(result.columns).toContain('gst_percent');
    expect(result.unknownHeaders).toHaveLength(1);
    expect(result.unknownHeaders[0]).toMatch(/duplicate/);
  });

  it('builds a record by position, defaulting missing cells to empty', () => {
    const { mapping } = mapCsvHeader(['name', 'case_price']);
    const record = rowToRecord(['Tea', '6600'], mapping);
    expect(record.name).toBe('Tea');
    expect(record.case_price).toBe('6600');
    expect(record.moq).toBe('');
  });
});

describe('import analysis', () => {
  it('accepts a valid row', () => {
    const report = analyzeProductCsv(csv(goodRow));
    expect(report.fatalErrors).toEqual([]);
    expect(report.validCount).toBe(1);
    expect(report.invalidCount).toBe(0);
    const row = report.rows[0]!;
    expect(row.issues).toEqual([]);
    expect(row.value?.name).toBe('Tata Tea Gold 1kg');
    expect(row.value?.gstPercent).toBe(5);
    expect(row.value?.moq).toBe(12);
    expect(row.brandName).toBe('Tata');
    expect(row.categoryName).toBe('Beverages');
    expect(row.isNewLaunch).toBe(true);
    // Spreadsheet line numbers are 1-based and count the header.
    expect(row.rowNumber).toBe(2);
  });

  it('reports row-level errors with the spreadsheet line number', () => {
    const report = analyzeProductCsv(csv(goodRow, override('gst_percent', '7')));
    expect(report.validCount).toBe(1);
    expect(report.invalidCount).toBe(1);
    const bad = report.rows[1]!;
    expect(bad.rowNumber).toBe(3);
    expect(bad.issues.some((issue) => issue.field === 'gstPercent')).toBe(true);
  });

  it('never silently ignores an invalid row — counts always add up', () => {
    const report = analyzeProductCsv(
      csv(
        goodRow,
        ['x'],
        override('hsn_code', '090'),
        override('barcode', '8901234567891')
      )
    );
    expect(report.rows).toHaveLength(4);
    expect(report.validCount + report.invalidCount).toBe(4);
    expect(report.validCount).toBe(1);
  });

  it('detects a barcode repeated inside the same file', () => {
    const report = analyzeProductCsv(csv(goodRow, goodRow));
    expect(report.invalidCount).toBe(1);
    const second = report.rows[1]!;
    expect(second.issues.some((issue) => issue.field === 'duplicate')).toBe(true);
    expect(second.issues[0]!.message).toMatch(/row 2/);
  });

  it('rejects a file with no name or case_price column before reading rows', () => {
    const report = analyzeProductCsv('brand,category\nTata,Beverages');
    expect(report.rows).toEqual([]);
    expect(report.fatalErrors.some((error) => error.includes('"name"'))).toBe(true);
    expect(report.fatalErrors.some((error) => error.includes('"case_price"'))).toBe(true);
  });

  it('refuses to proceed while an unknown column is present', () => {
    const text = `${HEADER},supplier\n${goodRow.join(',')},Acme`;
    const report = analyzeProductCsv(text);
    expect(report.rows).toEqual([]);
    expect(report.fatalErrors.some((error) => error.includes('supplier'))).toBe(true);
  });

  it('reports an empty file and a header-only file', () => {
    expect(analyzeProductCsv('').fatalErrors).toEqual(['The file is empty.']);
    expect(analyzeProductCsv(HEADER).fatalErrors[0]).toMatch(/no product rows/);
  });

  it('ignores fully blank lines between rows', () => {
    const report = analyzeProductCsv(`${HEADER}\n${goodRow.join(',')}\n\n\n`);
    expect(report.rows).toHaveLength(1);
  });

  it('refuses a file above the row ceiling', () => {
    const rows = Array.from({ length: MAX_IMPORT_ROWS + 1 }, () => goodRow.join(',')).join('\n');
    const report = analyzeProductCsv(`${HEADER}\n${rows}`);
    expect(report.fatalErrors[0]).toMatch(/limit is 2000/);
    expect(report.rows).toEqual([]);
  });
});

describe('template and export', () => {
  it('provides a header row plus one documented example', () => {
    const template = productCsvTemplate();
    expect(template[0]).toEqual([...PRODUCT_CSV_COLUMNS]);
    expect(template).toHaveLength(2);
    // The example must itself be a valid row, or the template teaches a bad file.
    const report = analyzeProductCsv(template.map((row) => row.join(',')).join('\n'));
    expect(report.fatalErrors).toEqual([]);
    expect(report.validCount).toBe(1);
  });

  it('export header is the template plus read-only stock context', () => {
    expect(PRODUCT_EXPORT_HEADER.slice(0, PRODUCT_CSV_COLUMNS.length)).toEqual([
      ...PRODUCT_CSV_COLUMNS,
    ]);
    expect(PRODUCT_EXPORT_HEADER).toContain('stock_status');
    expect(PRODUCT_EXPORT_HEADER).toContain('available_stock');
  });

  it('exports a row whose cell count matches the header', () => {
    const cells = productExportCells({
      name: 'Tea',
      brandName: 'Tata',
      categoryName: 'Beverages',
      unit: 'box',
      unitsPerCase: 12,
      mrp: 620,
      casePrice: 6600,
      costPrice: 5200,
      gstPercent: 5,
      hsnCode: '09023010',
      barcode: '8901234567890',
      leadTimeDays: 3,
      moq: 12,
      isNewLaunch: true,
      stockStatus: 'healthy',
      availableStock: 40,
    });
    expect(cells).toHaveLength(PRODUCT_EXPORT_HEADER.length);
  });
});

describe('result reporting', () => {
  it('summarises a clean import', () => {
    expect(describeImportResult({ attempted: 3, imported: 3, skipped: 0, failedRows: [] })).toBe(
      '3 of 3 row(s) imported.'
    );
  });

  it('always names the failures', () => {
    const summary = describeImportResult({
      attempted: 3,
      imported: 1,
      skipped: 1,
      failedRows: [
        { rowNumber: 2, message: 'GST must be a published slab.' },
        { rowNumber: 4, message: 'Barcode check digit is invalid.' },
      ],
    });
    expect(summary).toContain('1 of 3');
    expect(summary).toContain('1 skipped');
    expect(summary).toContain('row 2');
    expect(summary).toContain('row 4');
  });

  it('caps the inline failure list but still gives the true total', () => {
    const summary = describeImportResult({
      attempted: 20,
      imported: 0,
      skipped: 0,
      failedRows: Array.from({ length: 12 }, (_, index) => ({
        rowNumber: index + 2,
        message: 'bad',
      })),
    });
    expect(summary).toContain('(+4 more)');
  });
});
