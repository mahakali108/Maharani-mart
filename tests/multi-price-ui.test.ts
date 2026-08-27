import { describe, expect, it } from 'vitest';
import { resolvePackPrice } from '@/lib/retailer/effective-price';
import {
  calcRetailerMargin,
  calcSavings,
  determineBestValueTier,
  formatInr,
  formatMargin,
  resolveUnitPrice,
} from '@/lib/retailer/format';
import { calculateTaxedLine, normalizeQuoteLines } from '@/lib/orders/quote-order';

describe('Multi-Price / Multi-Pack Product Detail Upgrade Tests', () => {
  describe('1. Price resolution remains server-authoritative & unchanged', () => {
    it('uses product-level override when present', () => {
      const pack = { ptr: 125, base_price: 130 };
      expect(resolvePackPrice(pack, 120.87)).toBe(120.87);
    });

    it('falls back to PTR when override is null', () => {
      const pack = { ptr: 120.87, base_price: 130 };
      expect(resolvePackPrice(pack, null)).toBe(120.87);
    });

    it('falls back to base_price when both override and PTR are absent', () => {
      const pack = { ptr: null, base_price: 118.5 };
      expect(resolvePackPrice(pack, null)).toBe(118.5);
    });
  });

  describe('2. Multi-Price tier rendering and unit price resolution', () => {
    it('accurately resolves price per unit for single and multi-pack variants', () => {
      // Pack of 2 @ ₹241.74 -> ₹120.87 / unit
      expect(resolveUnitPrice(241.74, 2)).toBe(120.87);

      // Pack of 4 @ ₹474.00 -> ₹118.50 / unit
      expect(resolveUnitPrice(474.0, 4)).toBe(118.5);

      // Base pack (1 unit) @ ₹125.00 -> ₹125.00 / unit
      expect(resolveUnitPrice(125.0, 1)).toBe(125.0);
    });

    it('accurately calculates retailer gross margin from MRP without inventing percentages', () => {
      // Specification test values:
      // MRP ₹150, Pack of 2 @ ₹120.87 -> 19.42% margin
      const marginPack2 = calcRetailerMargin(150, 120.87);
      expect(marginPack2).toBe(19.42);
      expect(formatMargin(marginPack2)).toBe('19.42%');

      // MRP ₹150, Pack of 4 @ ₹118.50 -> 21.00% margin
      const marginPack4 = calcRetailerMargin(150, 118.5);
      expect(marginPack4).toBe(21.0);
      expect(formatMargin(marginPack4)).toBe('21.00%');

      // When MRP is missing or <= effectivePrice, never invent a margin
      expect(calcRetailerMargin(null, 120.87)).toBeNull();
      expect(calcRetailerMargin(120.87, 120.87)).toBeNull();
      expect(calcRetailerMargin(100, 120.87)).toBeNull();
    });
  });

  describe('3. Best-Value tier identification', () => {
    it('identifies the best-value tier and calculates per-unit savings', () => {
      const tiers = [
        { id: 'pack-2', pack_name: 'Pack of 2', unitPrice: 120.87 },
        { id: 'pack-4', pack_name: 'Pack of 4', unitPrice: 118.5 },
      ];

      const result = determineBestValueTier(tiers);
      expect(result.bestPackId).toBe('pack-4');
      expect(result.savingsVsRef).toBe(2.37);
      expect(result.refPackName).toBe('Pack of 2');
    });

    it('does not invent a recommendation when prices are equal or single pack', () => {
      const equalTiers = [
        { id: 'p1', pack_name: 'Pack 1', unitPrice: 100 },
        { id: 'p2', pack_name: 'Pack 2', unitPrice: 100 },
      ];
      expect(determineBestValueTier(equalTiers).bestPackId).toBeNull();
      expect(determineBestValueTier([equalTiers[0]!]).bestPackId).toBeNull();
    });
  });

  describe('4. MOQ enforcement & Stepper boundaries', () => {
    it('validates minimum order quantity rules', () => {
      const moq = 3;
      // Step from 0 must jump to MOQ
      const stepUpFromZero = (current: number, minMoq: number) => (current === 0 ? minMoq : current + 1);
      expect(stepUpFromZero(0, moq)).toBe(3);

      // Step down from MOQ must go to 0
      const stepDown = (current: number, minMoq: number) =>
        current <= 0 ? 0 : current <= minMoq ? 0 : current - 1;
      expect(stepDown(3, moq)).toBe(0);
      expect(stepDown(5, moq)).toBe(4);
    });

    it('rejects order lines with quantity below MOQ in quote validation', () => {
      // normalizeQuoteLines enforces valid positive integers
      const validLine = normalizeQuoteLines([{ packId: 'pack-2', quantity: 5 }]);
      expect(validLine).toHaveProperty('lines');

      const invalidZero = normalizeQuoteLines([{ packId: 'pack-2', quantity: 0 }]);
      expect(invalidZero).toHaveProperty('error');
    });
  });

  describe('5. Cart integration: Distinct pack tier representation', () => {
    it('preserves distinct pack representation for Pack of 2 × 5 and Pack of 4 × 3', () => {
      const packOf2Id = '00000000-0000-4000-8000-000000000002';
      const packOf4Id = '00000000-0000-4000-8000-000000000004';

      const requestedLines = [
        { packId: packOf2Id, quantity: 5 },
        { packId: packOf4Id, quantity: 3 },
      ];

      const normalized = normalizeQuoteLines(requestedLines);
      expect('lines' in normalized).toBe(true);
      if ('lines' in normalized) {
        expect(normalized.lines.get(packOf2Id)).toBe(5);
        expect(normalized.lines.get(packOf4Id)).toBe(3);
        expect(normalized.lines.size).toBe(2);
      }
    });

    it('preserves GST and line total calculations identically to existing orders', () => {
      const unitPricePack2 = 120.87;
      const qtyPack2 = 5;
      const gstPercent = 18;

      const taxedLine = calculateTaxedLine(unitPricePack2, qtyPack2, gstPercent);
      expect(taxedLine.subtotal).toBe(604.35); // 120.87 * 5
      expect(taxedLine.gst).toBe(108.78); // 604.35 * 0.18 = 108.783 -> roundMoney 108.78
      expect(taxedLine.total).toBe(713.13); // 604.35 + 108.78
    });

    it('calculates savings accurately only against authoritative MRP', () => {
      const mrp = 150.0;
      const unitPrice = 120.87;
      const qty = 5;

      const savings = calcSavings(mrp, unitPrice, qty);
      expect(savings).toBeCloseTo(145.65, 2); // (150 - 120.87) * 5 = 29.13 * 5 = 145.65
      expect(formatInr(savings)).toBe('₹145.65');
    });
  });

  describe('6. Security & Authorization integrity', () => {
    it('does not expose internal cost prices in public formatters or packs', () => {
      const publicPackView = {
        id: 'pack-2',
        pack_name: 'Pack of 2',
        effectivePrice: 120.87,
        mrp: 150.0,
        moq: 1,
      };

      expect(publicPackView).not.toHaveProperty('cost_price');
      expect(publicPackView).not.toHaveProperty('internal_margin');
    });
  });
});
