/**
 * CSV export helper — pure and unit-tested (tests/csv-export.test.ts).
 * Follows the escaping rules of the existing retailer statement route:
 * every cell quoted, embedded quotes doubled, CRLF-free rows.
 */

export type CsvCell = string | number | boolean | null | undefined;

export function csvCell(value: CsvCell): string {
  const text =
    value === null || value === undefined
      ? ''
      : typeof value === 'boolean'
        ? value
          ? 'yes'
          : 'no'
        : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

export function toCsv(header: string[], rows: CsvCell[][]): string {
  const lines = [header.map(csvCell).join(','), ...rows.map((row) => row.map(csvCell).join(','))];
  return lines.join('\n');
}

/** Filename stamp for downloads: YYYY-MM-DD from an ISO timestamp. */
export function csvStamp(iso: string): string {
  return iso.slice(0, 10);
}
