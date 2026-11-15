import { describe, expect, it } from 'vitest';
import { LEGAL_DOCUMENTS, NOT_APPLICABLE_DOCUMENTS, REQUIRED_ACCEPTANCE, legalDocumentByKey } from '@/lib/legal/documents';
import { POLICY_CONTENT } from '@/lib/legal/content';

/**
 * The registry's job has narrowed since migration 0104: it is no longer the text
 * of the pages (that is Super Admin managed content). It remains the register of
 * WHICH documents exist, the acceptance keys, and the default version used by
 * `record_legal_acceptance` when the database has no current-version row.
 *
 * Page rendering is covered by site-content-public.test.tsx and the seed by
 * site-content-seed.test.ts; nothing here asserts a page's wording.
 */
describe('legal document registry', () => {
  it('covers documents A–Q once each, with R explicitly not applicable', () => {
    expect(LEGAL_DOCUMENTS.map((doc) => doc.ref).join('')).toBe('ABCDEFGHIJKLMNOPQ');
    expect(NOT_APPLICABLE_DOCUMENTS.map((doc) => doc.ref)).toEqual(['R']);
    expect(new Set(LEGAL_DOCUMENTS.map((doc) => doc.key)).size).toBe(LEGAL_DOCUMENTS.length);
    expect(new Set(LEGAL_DOCUMENTS.map((doc) => doc.href)).size).toBe(LEGAL_DOCUMENTS.length);
  });

  it('gives every document a version, an effective date and a summary', () => {
    for (const doc of LEGAL_DOCUMENTS) {
      expect(doc.version).toMatch(/^\d+\.\d+$/);
      expect(doc.effectiveDate).toMatch(/^\d{2} [A-Z][a-z]+ \d{4}$/);
      expect(doc.lastUpdated).toMatch(/^\d{2} [A-Z][a-z]+ \d{4}$/);
      expect(doc.summary.length).toBeGreaterThan(20);
      // The key is also the public address, and the seeded page slug.
      expect(doc.href).toBe(`/legal/${doc.key}`);
    }
  });

  it('only requires acceptance of documents that exist', () => {
    for (const keys of Object.values(REQUIRED_ACCEPTANCE)) {
      for (const key of keys) expect(legalDocumentByKey(key), key).toBeDefined();
    }
  });

  it('keeps the seller agreement required for sellers', () => {
    expect(REQUIRED_ACCEPTANCE.seller).toContain('seller-agreement');
    expect(REQUIRED_ACCEPTANCE.seller).toContain('prohibited-products');
    expect(REQUIRED_ACCEPTANCE.retailer).toEqual(['terms', 'privacy', 'retailer-terms']);
  });

  it('still contains no invented GSTIN or absolute claim in the starter wording', () => {
    const all = JSON.stringify(POLICY_CONTENT);
    expect(all).not.toMatch(/\b\d{2}[A-Z]{5}\d{4}[A-Z]\d[A-Z]\d\b/);
    expect(all).not.toMatch(/100% (secure|safe|genuine|compliant)|fully compliant|guaranteed? delivery|bank-grade/i);
  });

  it('keeps the no-food and invitation-only seller rules in the starter wording', () => {
    expect(JSON.stringify(POLICY_CONTENT['prohibited-products'])).toMatch(/Food and drink of any kind/);
    expect(JSON.stringify(POLICY_CONTENT['seller-agreement'])).toMatch(/invitation issued by the Super Admin/);
  });
});
