import { describe, expect, it } from 'vitest';
import { calculateCreditPosition } from '@/lib/orders/credit';
import { calculateTaxedLine, normalizeQuoteLines } from '@/lib/orders/quote-order';
import { sanitizeSearchTerm } from '@/lib/retailer/catalog-params';

describe('shared order business rules', () => {
  it('reuses configured credit semantics including zero = not configured', () => {
    expect(calculateCreditPosition(0, 500, 1000)).toMatchObject({ hasConfiguredLimit: false, availableCredit: null, exceedsLimit: false });
    expect(calculateCreditPosition(20_000, 5_000, 14_000)).toMatchObject({ availableCredit: 15_000, availableAfterOrder: 1_000, exceedsLimit: false });
    expect(calculateCreditPosition(20_000, 5_000, 16_000).exceedsLimit).toBe(true);
  });

  it('uses the quote service GST rounding calculation', () => {
    expect(calculateTaxedLine(99.99, 10, 18)).toEqual({ subtotal: 999.9, gst: 179.98, total: 1179.88 });
  });

  it('rejects invalid quantities, duplicate packs and preserves MOQ validation for the DB-backed quote', () => {
    expect(normalizeQuoteLines([{ packId: 'pack', quantity: 0 }])).toHaveProperty('error');
    expect(normalizeQuoteLines([{ packId: 'pack', quantity: 2 }, { packId: 'pack', quantity: 3 }])).toHaveProperty('error');
    expect(normalizeQuoteLines([{ packId: 'pack', quantity: 2 }])).toHaveProperty('lines');
  });

  it('sanitizes product search input before PostgREST filters', () => {
    expect(sanitizeSearchTerm("Colgate%,_* 100g")).toBe('Colgate 100g');
    expect(sanitizeSearchTerm('x'.repeat(200))).toHaveLength(80);
  });
});
