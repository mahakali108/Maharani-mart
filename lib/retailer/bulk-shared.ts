import { sanitizeSearchTerm } from '@/lib/retailer/catalog-params';

/**
 * Pure bulk-order-list parsing shared by the server action and the tests.
 * Kept out of the 'use server' module because Next.js only allows async
 * exports from server-action files.
 */

export interface ParsedBulkLine {
  quantity: number | null;
  term: string;
  line: string;
}

/**
 * Parses a pasted order list into (quantity, term) pairs. Accepted shapes
 * per line:
 *   `2 x parle-g 50g`   `2x parle-g`   `parle-g 50g x 24`   `parle-g`
 * A bare term gets quantity null (the UI fills the pack MOQ).
 */
export function parseBulkOrderLines(raw: string, maxLines = 20): ParsedBulkLine[] {
  const results: ParsedBulkLine[] = [];
  const seen = new Set<string>();
  for (const rawLine of raw.split('\n')) {
    const line = rawLine.trim();
    if (!line || results.length >= maxLines) continue;

    let quantity: number | null = null;
    let term = line;

    const leading = line.match(/^(\d{1,5})\s*[x×*]\s*(.+)$/i);
    if (leading) {
      quantity = Number(leading[1]);
      term = leading[2] ?? '';
    } else {
      const trailing = line.match(/^(.+?)\s*[x×*]\s*(\d{1,5})$/i);
      if (trailing) {
        term = trailing[1] ?? '';
        quantity = Number(trailing[2]);
      }
    }

    const cleanTerm = sanitizeSearchTerm(term);
    if (!cleanTerm) continue;
    if (quantity !== null && (!Number.isInteger(quantity) || quantity < 1 || quantity > 100000)) quantity = null;
    const dedupeKey = `${cleanTerm.toLowerCase()}|${quantity ?? ''}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    results.push({ quantity, term: cleanTerm, line });
  }
  return results;
}
