import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LEGAL_DOCUMENTS, NOT_APPLICABLE_DOCUMENTS } from '@/lib/legal/documents';

/**
 * BUSINESS IDENTITY GUARD.
 *
 * Maharani Traders operates under several names that must stay strictly
 * separate, and none of them may be presented as the legal seller, the invoice
 * issuer, the GST registrant or the website owner without the owner's explicit
 * verification:
 *
 *   - Maharani Traders / "Maha Bazar by Maharani"  -> customer-facing BRAND
 *   - Ajay General                                 -> separate business identity
 *   - Maa Kali Enterprises                         -> separate business identity
 *   - Maharani                                     -> a brand, NOT a legal entity
 *
 * This suite is the mechanical half of that rule: it fails if customer-facing
 * content asserts a legal role for any of those names, or if a GSTIN, address,
 * phone number or grievance contact is invented.
 */

const root = process.cwd();
const read = (p: string) => readFileSync(join(root, p), 'utf8');

/** Every customer-facing content surface that is not a test fixture. */
function customerFacingSources(): { path: string; source: string }[] {
  const out: { path: string; source: string }[] = [];
  const push = (p: string) => out.push({ path: p, source: read(p) });
  push('content/site-pages.seed.json');
  push('supabase/migrations/0105_seed_site_content.sql');
  // 0110 carries a replacement TABLE: the `from` side must contain the old
  // sentences verbatim or it could never match. Only the `to` side — the text
  // that actually reaches a customer — is scanned.
  out.push({
    path: 'supabase/migrations/0110_retire_seller_supplier_marketplace.sql',
    source: [...read(
      'supabase/migrations/0110_retire_seller_supplier_marketplace.sql',
    ).matchAll(/"to":\s*"((?:[^"\\]|\\.)*)"/g)]
      .map((m) => m[1])
      .join('\n'),
  });
  // Same reasoning as 0110: the generator holds `[from, to]` pairs. Only the
  // replacement (second element) can reach a customer, so scan that.
  out.push({
    path: 'scripts/generate-site-content-seed.mjs',
    source: read('scripts/generate-site-content-seed.mjs')
      .split('\n')
      .filter((line) => /^\s+'/.test(line) && /\]\s*,\s*$/.test(line))
      .join('\n'),
  });
  push('lib/legal/content.ts');
  push('lib/legal/documents.ts');
  return out;
}

/**
 * Phrases that ASSERT a legal/statutory role rather than describing a brand.
 *
 * Note the deliberate exclusions: a NEGATED sentence ("does not assume that ...
 * is the legal seller") is the disclaimer we want, not the claim we forbid, so
 * each pattern requires an affirmative construction.
 */
const UNVERIFIED_ROLE_ASSERTIONS = [
  /\b(is|are|am) the seller of record/i,
  /we are the seller of record/i,
  /\b(is|are) therefore the seller of record/i,
  // `[^.]{0,40}` would span the "does not assume ..." disclaimer; require the
  // affirmative form to sit close to the noun it is predicated on.
  /\b(brand|name|entity)\b(?:\s+\w+){0,3}\s+is the legal seller\b/i,
  /\b(is|are) the (sole|legal) (invoice issuer|seller|GST registrant)\b/i,
  /\boperated by Maharani\b(?! Traders)/i,
  /\bowned by Maharani\b(?! Traders)/i,
  // An invoice-issuer role asserted for the brand rather than for the
  // proprietorship the owner named. Easy to write by accident ("every order is
  // fulfilled and invoiced by Maharani Traders") and it was in the copy once.
  // "sold by Maharani Traders" is NOT flagged: the owner confirmed the
  // proprietorship trades under that brand, so selling under it is accurate. What
  // is not accurate is naming the BRAND as the invoice issuer.
  /\b(invoiced|billed) by Maharani\b/i,
];

describe('no unverified seller-of-record / invoice-issuer / GST claims', () => {
  it('contains no sentence asserting a legal role for a brand name', () => {
    for (const { path, source } of customerFacingSources()) {
      for (const pattern of UNVERIFIED_ROLE_ASSERTIONS) {
        const match = pattern.exec(source);
        expect(match, `${path} asserts a legal role: "${match?.[0] ?? pattern}"`).toBeNull();
      }
    }
  });

  it('does describe where the responsible business identity is actually stated', () => {
    // Removing a false claim is not enough: the reader must be told where to find
    // the real answer, otherwise the page is merely silent about who sells.
    const seed = read('content/site-pages.seed.json');
    // The reader must be told who sells, or told where to find out. The owner has
    // now named the entity, so the stronger form applies: it is stated outright.
    expect(seed).toMatch(/AJAY GENERAL proprietorship/);
    expect(seed).toMatch(/printed on the invoice/);
  });

  it('never re-introduces the marketplace framing it replaced', () => {
    for (const { path, source } of customerFacingSources()) {
      // 'from', 'to' and the historical originals live in the generators, so the
      // phrase is only forbidden where it would reach a customer: the seed and
      // 0105's seeded arrays.
      if (path === 'content/site-pages.seed.json') {
        expect(source, path).not.toMatch(/marketplace and seller features/);
      }
    }
  });
});

describe('brand and business identities stay separate', () => {
  it('states the owner-approved seller identity, attributed to the proprietorship', () => {
    // The owner answered the open question: the AJAY GENERAL proprietorship is
    // the seller and invoice issuer, trading under the brand MAHARANI TRADERS.
    // Assert that fact is STATED (not merely deferred) and that it is attributed
    // to the proprietorship rather than to the brand.
    const seed = read('content/site-pages.seed.json');
    const claims = [...seed.matchAll(/The seller[^"]{0,40}? is the AJAY GENERAL proprietorship[^"]*?registered for that business\./g)];
    expect(claims.length, 'the approved seller-identity sentence must be present').toBeGreaterThan(0);
    // It never claims a GST NUMBER or address: the registered values are printed
    // on the invoice and have not been supplied yet.
    for (const claim of claims) expect(claim[0]).toMatch(/printed on the invoice/);
  });

  it('treats Maharani as a brand, never as an incorporated legal entity', () => {
    const seed = read('content/site-pages.seed.json');
    // The one identity statement the owner has actually provided.
    expect(seed).toContain('AJAY GENERAL');
    expect(seed).toContain('MAHARANI TRADERS');
    // "Maharani" alone must never be described as a company/entity/firm.
    expect(seed).not.toMatch(/Maharani\s+(Pvt|Private|Limited|Ltd|LLP|Inc)\b/i);
    expect(seed).not.toMatch(/\bMaharani\b[^.]{0,40}\bis a (company|legal entity|firm|partnership)\b/i);
  });

  it('does not conflate Ajay General or Maa Kali Enterprises with the brand', () => {
    const seed = read('content/site-pages.seed.json');
    // Ajay General is described as a registered TRADE NAME of the proprietorship,
    // which is what the owner stated — not as a separate seller or entity.
    const ajayMentions = [...seed.matchAll(/AJAY GENERAL/g)].length;
    expect(ajayMentions).toBeGreaterThan(0);
    expect(seed).not.toMatch(/AJAY GENERAL is (a|the) (seller|company|legal entity)/i);
    // Maa Kali Enterprises must not be introduced as a seller/issuer anywhere.
    for (const { path, source } of customerFacingSources()) {
      if (!/maa kali/i.test(source)) continue;
      expect(source, path).not.toMatch(/Maa Kali[^.]{0,60}(seller of record|invoice issuer|GST registrant)/i);
    }
  });

  it('does not invent a GSTIN, address, phone or grievance contact', () => {
    // A syntactically valid Indian GSTIN has 15 chars: 2 digits, 5 letters,
    // 4 digits, 1 letter, 1 digit, 1 letter/digit.
    const gstinPattern = /\b\d{2}[A-Z]{5}\d{4}[A-Z]\d[A-Z][0-9A-Z]\b/;
    for (const { path, source } of customerFacingSources()) {
      expect(gstinPattern.exec(source)?.[0], `${path} contains a GSTIN`).toBeUndefined();
    }

    // The ONLY contact details permitted are the owner-provided ones.
    const seed = read('content/site-pages.seed.json');
    const allowedPhones = ['8987023959'];
    const phones = [...seed.matchAll(/\b[6-9]\d{9}\b/g)].map((m) => m[0]);
    for (const phone of new Set(phones)) {
      expect(allowedPhones, `unexpected phone number ${phone}`).toContain(phone);
    }
    const emails = [...seed.matchAll(/[\w.+-]+@[\w-]+\.[\w.]+/g)].map((m) => m[0]);
    for (const email of new Set(emails)) {
      expect(['adinathsahu8987@gmail.com'], `unexpected email ${email}`).toContain(email);
    }
  });

  it('keeps the grievance officer as the owner-provided person only', () => {
    const seed = read('content/site-pages.seed.json');
    const officers = [...seed.matchAll(/Grievance Officer:\s*([^\n"]+)/g)].map((m) => m[1]!.trim());
    expect(officers.length).toBeGreaterThan(0);
    for (const officer of officers) expect(officer).toBe('AJAY KUMAR, Proprietor');
  });
});

describe('statutory disclosures are preserved', () => {
  it('keeps every registry document, including the ones never published', () => {
    // Nothing may be deleted to hide inaccuracy: the registry stays complete.
    expect(LEGAL_DOCUMENTS.map((d) => d.ref).join('')).toBe('ABCDEFGHIJKLMNOPQ');
    expect(NOT_APPLICABLE_DOCUMENTS.map((d) => d.ref)).toEqual(['R']);
    const keys = LEGAL_DOCUMENTS.map((d) => d.key);
    expect(keys).toContain('seller-agreement');
    expect(keys).toContain('marketplace-disclaimer');
    expect(keys).toContain('business-disclosure');
    expect(keys).toContain('grievance');
  });

  it('keeps the historical marketplace records rather than deleting them', () => {
    const seed = JSON.parse(read('content/site-pages.seed.json')) as {
      pages: { slug: string; sections: { heading: string; body: string[] }[] }[];
    };
    const disclaimer = seed.pages.find((p) => p.slug === 'marketplace-disclaimer');
    expect(disclaimer, 'the historical marketplace record must survive').toBeDefined();
    const agreement = seed.pages.find((p) => p.slug === 'seller-agreement');
    expect(agreement, 'the historical seller agreement must survive').toBeDefined();
  });

  it('keeps the statutory contact block exactly as the owner supplied it', () => {
    const seed = read('content/site-pages.seed.json');
    for (const required of [
      'Proprietor: AJAY KUMAR',
      'Registered trade name: AJAY GENERAL',
      'Brand: MAHARANI TRADERS',
      'Grievance Officer: AJAY KUMAR, Proprietor',
      'Plot No. 231, Ander Bazar, Belaganj, Gaya, Bihar – 804403',
      '8987023959',
      'adinathsahu8987@gmail.com',
    ]) {
      expect(seed, required).toContain(required);
    }
  });

  it('leaves uncertain text marked for professional review instead of strengthening it', () => {
    const seed = read('content/site-pages.seed.json');
    expect(seed).toMatch(/has not been independently verified|have not been independently verified/);
  });
});
