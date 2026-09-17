import { describe, expect, it } from 'vitest';
import {
  GST_RATE_LABEL,
  derivedPiecePrice,
  eanChecksumValid,
  firstError,
  parseGstRate,
  validateBarcode,
  validateHsnCode,
  validateProductDraft,
} from '@/lib/admin/catalog-validation';

/** A draft that passes every rule, so each test changes exactly one thing. */
const validDraft = {
  name: 'Tata Tea Gold 1kg',
  unit: 'box',
  unitsPerCase: 12,
  mrp: 620,
  casePrice: 6600,
  costPrice: '480',
  gstPercent: '5',
  hsnCode: '09023010',
  barcode: '8901234567890',
  leadTimeDays: '3',
  moq: '12',
};

describe('GST rate validation', () => {
  it('accepts only the published statutory slabs', () => {
    for (const rate of [0, 0.25, 3, 5, 12, 18, 28]) {
      expect(parseGstRate(String(rate))).toBe(rate);
    }
  });

  it('rejects plausible-looking but non-statutory rates', () => {
    // 7% and 15% would produce an invoice no GST return recognises.
    expect(parseGstRate('7')).toBeNull();
    expect(parseGstRate('15')).toBeNull();
    expect(parseGstRate('99')).toBeNull();
    expect(parseGstRate('-5')).toBeNull();
    expect(parseGstRate('abc')).toBeNull();
  });

  it('reports the allowed slabs in the error message', () => {
    const result = validateProductDraft({ ...validDraft, gstPercent: '7' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.gstPercent).toContain(GST_RATE_LABEL);
    }
  });

  it('treats a blank GST as 0 rather than an error', () => {
    const result = validateProductDraft({ ...validDraft, gstPercent: '' });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.gstPercent).toBe(0);
  });
});

describe('HSN validation', () => {
  it('accepts 2, 4, 6 and 8 digit codes and preserves leading zeros', () => {
    for (const code of ['09', '0902', '090230', '09023010']) {
      const result = validateHsnCode(code);
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value).toBe(code);
    }
  });

  it('rejects odd digit counts and non-digits', () => {
    expect(validateHsnCode('090').ok).toBe(false);
    expect(validateHsnCode('09023').ok).toBe(false);
    expect(validateHsnCode('090230100').ok).toBe(false);
    expect(validateHsnCode('09O2').ok).toBe(false);
  });

  it('treats a blank HSN as "not set", which is legal', () => {
    const empty = validateHsnCode('   ');
    expect(empty.ok).toBe(true);
    if (empty.ok) expect(empty.value).toBeNull();
  });
});

describe('EAN / UPC barcode validation', () => {
  it('accepts a real EAN-13 and the other retail lengths', () => {
    expect(eanChecksumValid('8901234567890')).toBe(true); // EAN-13
    expect(eanChecksumValid('4006381333931')).toBe(true); // EAN-13
    expect(eanChecksumValid('036000291452')).toBe(true); // UPC-A
    expect(eanChecksumValid('96385074')).toBe(true); // EAN-8
  });

  it('rejects a wrong check digit — the typo that never scans', () => {
    expect(eanChecksumValid('8901234567891')).toBe(false);
  });

  it('rejects wrong lengths and non-digits', () => {
    expect(eanChecksumValid('890123456789')).toBe(false);
    expect(eanChecksumValid('89012345678901')).toBe(false);
    expect(eanChecksumValid('890123456789X')).toBe(false);
  });

  it('surfaces the check-digit problem in a field error', () => {
    const result = validateProductDraft({ ...validDraft, barcode: '8901234567891' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.barcode).toMatch(/check digit/i);
  });

  it('allows no barcode at all', () => {
    expect(validateBarcode('').ok).toBe(true);
    expect(validateBarcode(null).ok).toBe(true);
  });
});

describe('product draft validation', () => {
  it('accepts a complete valid draft and trims/normalises it', () => {
    const result = validateProductDraft({ ...validDraft, name: '  Tata   Tea  Gold 1kg ' });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.name).toBe('Tata Tea Gold 1kg');
      expect(result.value.unitsPerCase).toBe(12);
      expect(result.value.moq).toBe(12);
      expect(result.value.costPrice).toBe(480);
    }
  });

  it('reports every failing field at once, not just the first', () => {
    const result = validateProductDraft({
      ...validDraft,
      name: 'x',
      unit: '',
      gstPercent: '7',
      hsnCode: '123',
      moq: '0',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(Object.keys(result.errors).sort()).toEqual(
        ['gstPercent', 'hsnCode', 'moq', 'name', 'unit'].sort()
      );
    }
  });

  it('requires a positive MOQ', () => {
    expect(validateProductDraft({ ...validDraft, moq: '0' }).ok).toBe(false);
    expect(validateProductDraft({ ...validDraft, moq: '-3' }).ok).toBe(false);
    expect(validateProductDraft({ ...validDraft, moq: '1.5' }).ok).toBe(false);
    expect(validateProductDraft({ ...validDraft, moq: '1' }).ok).toBe(true);
  });

  it('requires whole, positive units per case', () => {
    expect(validateProductDraft({ ...validDraft, unitsPerCase: '0' }).ok).toBe(false);
    expect(validateProductDraft({ ...validDraft, unitsPerCase: '2.5' }).ok).toBe(false);
    expect(validateProductDraft({ ...validDraft, unitsPerCase: '100000' }).ok).toBe(false);
  });

  it('rejects negative prices', () => {
    expect(validateProductDraft({ ...validDraft, casePrice: '-1' }).ok).toBe(false);
    expect(validateProductDraft({ ...validDraft, mrp: '-1' }).ok).toBe(false);
    expect(validateProductDraft({ ...validDraft, costPrice: '-1' }).ok).toBe(false);
  });

  it('allows a blank cost but rejects a negative one', () => {
    const blank = validateProductDraft({ ...validDraft, costPrice: '' });
    expect(blank.ok).toBe(true);
    if (blank.ok) expect(blank.value.costPrice).toBeNull();
    expect(validateProductDraft({ ...validDraft, costPrice: '-5' }).ok).toBe(false);
  });

  it('rejects a case price below purchase cost (negative margin)', () => {
    // 12 pieces at 4000/case = 333.33/pc against a 480/pc cost.
    const result = validateProductDraft({ ...validDraft, casePrice: '4000' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.margin).toMatch(/below the/i);
  });

  it('accepts a case price above cost', () => {
    expect(validateProductDraft({ ...validDraft, casePrice: '6600' }).ok).toBe(true);
  });

  it('does not complain about margin while the price itself is invalid', () => {
    const result = validateProductDraft({ ...validDraft, casePrice: 'abc' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.casePrice).toBeDefined();
      expect(result.errors.margin).toBeUndefined();
    }
  });

  it('rejects an absurd lead time', () => {
    expect(validateProductDraft({ ...validDraft, leadTimeDays: '400' }).ok).toBe(false);
  });

  it('derives the GST-inclusive piece price the same way the storefront does', () => {
    expect(derivedPiecePrice(6600, 12)).toBe(550);
    expect(derivedPiecePrice(100, 3)).toBe(33.33);
    expect(derivedPiecePrice(100, 0)).toBe(0);
  });

  it('gives a single usable message for one-line surfaces', () => {
    const result = validateProductDraft({ ...validDraft, unit: '' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(firstError(result.errors)).toMatch(/unit/i);
  });
});
