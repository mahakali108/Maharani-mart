import { describe, expect, it } from 'vitest';
import { csvCell, csvStamp, toCsv } from '@/lib/admin/csv';

describe('CSV cell escaping', () => {
  it('quotes every cell and doubles embedded quotes', () => {
    expect(csvCell('plain')).toBe('"plain"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('comma, inside')).toBe('"comma, inside"');
    expect(csvCell('line\nbreak')).toBe('"line\nbreak"');
  });

  it('renders null, undefined and booleans deterministically', () => {
    expect(csvCell(null)).toBe('""');
    expect(csvCell(undefined)).toBe('""');
    expect(csvCell(true)).toBe('"yes"');
    expect(csvCell(false)).toBe('"no"');
    expect(csvCell(0)).toBe('"0"');
    expect(csvCell(12.5)).toBe('"12.5"');
  });
});

describe('CSV document builder', () => {
  it('joins header and rows with commas and newlines', () => {
    const csv = toCsv(['A', 'B'], [
      [1, 'x'],
      [2, 'y,z'],
    ]);
    expect(csv).toBe('"A","B"\n"1","x"\n"2","y,z"');
  });

  it('handles an empty row set (header only)', () => {
    expect(toCsv(['Only', 'Header'], [])).toBe('"Only","Header"');
  });

  it('escapes injection attempts through cell content', () => {
    const csv = toCsv(['Formula'], [['=CMD(\'del *\')']]);
    expect(csv).toBe('"Formula"\n"=CMD(\'del *\')"');
    // The leading = stays inside quotes: consumers importing with quote
    // handling are safe; we never strip or interpret content.
  });
});

describe('csvStamp', () => {
  it('extracts the ISO date for filenames', () => {
    expect(csvStamp('2025-09-11T10:30:00.000Z')).toBe('2025-09-11');
  });
});
