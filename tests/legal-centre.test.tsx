import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { existsSync, readFileSync } from 'node:fs';

vi.mock('next/navigation', () => ({ notFound: () => { throw new Error('NOT_FOUND'); } }));

import LegalIndex from '@/app/legal/page';
import PolicyDocumentPage, { generateStaticParams, dynamicParams } from '@/app/legal/[slug]/page';
import { LEGAL_DOCUMENTS, NOT_APPLICABLE_DOCUMENTS, REQUIRED_ACCEPTANCE, legalDocumentByKey } from '@/lib/legal/documents';
import { POLICY_CONTENT } from '@/lib/legal/content';

const render = async (slug: string) => renderToStaticMarkup(await PolicyDocumentPage({ params: Promise.resolve({ slug }) }));

describe('legal document registry', () => {
  it('covers documents A–Q once each, with R explicitly not applicable', () => {
    expect(LEGAL_DOCUMENTS.map((doc) => doc.ref).join('')).toBe('ABCDEFGHIJKLMNOPQ');
    expect(NOT_APPLICABLE_DOCUMENTS.map((doc) => doc.ref)).toEqual(['R']);
    expect(new Set(LEGAL_DOCUMENTS.map((doc) => doc.key)).size).toBe(LEGAL_DOCUMENTS.length);
    expect(new Set(LEGAL_DOCUMENTS.map((doc) => doc.href)).size).toBe(LEGAL_DOCUMENTS.length);
  });

  it('gives every document a version, an effective date and a last-updated date', () => {
    for (const doc of LEGAL_DOCUMENTS) {
      expect(doc.version).toMatch(/^\d+\.\d+$/);
      expect(doc.effectiveDate).toMatch(/^\d{2} [A-Z][a-z]+ \d{4}$/);
      expect(doc.lastUpdated).toMatch(/^\d{2} [A-Z][a-z]+ \d{4}$/);
      expect(doc.summary.length).toBeGreaterThan(20);
    }
  });

  it('backs every registered document with a real page (no dead links)', () => {
    for (const doc of LEGAL_DOCUMENTS) {
      const slug = doc.href.replace('/legal/', '');
      const hasStaticPage = existsSync(`app/legal/${slug}/page.tsx`);
      expect(hasStaticPage || Boolean(POLICY_CONTENT[slug]), doc.href).toBe(true);
      if (hasStaticPage) expect(readFileSync(`app/legal/${slug}/page.tsx`, 'utf8')).toContain(`documentKey="${doc.key}"`);
    }
  });

  it('only requires acceptance of documents that exist', () => {
    for (const keys of Object.values(REQUIRED_ACCEPTANCE)) for (const key of keys) expect(legalDocumentByKey(key)).toBeDefined();
  });
});

describe('legal centre index', () => {
  it('lists every document with its version and dates, and explains the omitted one', () => {
    const html = renderToStaticMarkup(<LegalIndex />);
    for (const doc of LEGAL_DOCUMENTS) {
      expect(html).toContain(`href="${doc.href}"`);
      expect(html).toContain(`Version ${doc.version} · Effective ${doc.effectiveDate} · Last updated ${doc.lastUpdated}`);
    }
    expect(html).toContain('Advertising and Sponsored Listing Disclosure');
    expect(html).toContain('no paid advertising or sponsored product placement');
  });
});

describe('generated policy documents', () => {
  it('pre-renders exactly the documents that have content and 404s on anything else', async () => {
    expect(dynamicParams).toBe(false);
    expect(generateStaticParams().map((p) => p.slug).sort()).toEqual(Object.keys(POLICY_CONTENT).sort());
    await expect(render('does-not-exist')).rejects.toThrow('NOT_FOUND');
  });

  it.each(Object.keys(POLICY_CONTENT))('%s renders substantive, dated, versioned content', async (slug) => {
    const html = await render(slug);
    const doc = legalDocumentByKey(slug)!;
    expect(html).toContain(doc.title);
    expect(html).toContain('aria-label="Document version"');
    expect(html).toContain(doc.effectiveDate);
    expect(html).toContain('Publication review required.');
    const content = POLICY_CONTENT[slug]!;
    expect(content.sections.length).toBeGreaterThanOrEqual(3);
    const words = JSON.stringify(content.sections).split(/\s+/).length;
    expect(words).toBeGreaterThan(150);
    for (const key of content.related ?? []) expect(legalDocumentByKey(key), `${slug} → ${key}`).toBeDefined();
  });

  it('contains no placeholder text and no unverifiable absolute claim', () => {
    const all = JSON.stringify(POLICY_CONTENT);
    expect(all).not.toMatch(/lorem ipsum|TODO|TBD|\[insert|xxxx|example\.com/i);
    expect(all).not.toMatch(/100% (secure|safe|genuine|compliant)|fully compliant|guaranteed? delivery|bank-grade|ISO ?27001|PCI/i);
    // No GSTIN-shaped or licence-number-shaped string may be invented here.
    expect(all).not.toMatch(/\b\d{2}[A-Z]{5}\d{4}[A-Z]\d[A-Z]\d\b/);
  });

  it('states the no-food rule and the invitation-only seller rule', () => {
    expect(JSON.stringify(POLICY_CONTENT['prohibited-products'])).toMatch(/Food and drink of any kind/);
    expect(JSON.stringify(POLICY_CONTENT['seller-agreement'])).toMatch(/invitation issued by the Super Admin/);
    expect(JSON.stringify(POLICY_CONTENT['seller-agreement'])).toMatch(/Food and drink of every kind are not permitted/);
  });

  it('does not promise a return window, refund time or loyalty redemption that the owner has not approved', () => {
    const all = JSON.stringify({ ...POLICY_CONTENT, sections: undefined });
    const promises = JSON.stringify(Object.values(POLICY_CONTENT).map((c) => c.sections));
    expect(promises).not.toMatch(/within \d+ (working |business )?(day|hour)s?/i);
    expect(promises).toContain('cannot be redeemed against an order');
    expect(all).toContain('software default is 7 days');
  });
});
