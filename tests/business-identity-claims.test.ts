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
 *   - Maha Bazar by Maharani   -> the customer-facing website / app name
 *   - Maharani Traders         -> the brand / trading style (NOT a legal entity)
 *   - Ajay General             -> the proprietorship: legal seller + invoice issuer
 *   - Maa Kali Enterprises     -> a separate business identity, nothing more
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

/**
 * The owner approved ONE legal-role sentence: "AJAY GENERAL is the legal seller
 * and invoice issuer" (and its contact-block form "Legal seller and invoice
 * issuer: AJAY GENERAL (proprietorship)"). The claim itself is therefore
 * allowed; what is forbidden is predicating it of anything other than Ajay
 * General. Each occurrence is sliced out and the sentence it sits in is checked
 * for an approved subject. This is stricter than forbidding the phrase: it fails
 * on a new surface that says "Maharani Traders is the legal seller", and it
 * still fails on the old "…and is not connected to this business" sentence.
 */
const APPROVED_ISSUER_SUBJECTS = [/\bajay\s+general\b/i];

const LEGAL_ROLE_PREDICATE =
  /(\b(?:is|are|am)\s+the\s+(?:sole\s+|legal\s+)?(?:seller of record|invoice issuer|legal seller|GST registrant)\b|\b(?:invoiced|billed)\s+by\s+\w+)/gi;

describe('no unverified seller-of-record / invoice-issuer / GST claims', () => {
  it('attributes every legal-role claim to the owner-approved proprietorship', () => {
    for (const { path, source } of customerFacingSources()) {
      for (const match of source.matchAll(LEGAL_ROLE_PREDICATE)) {
        const at = match.index ?? 0;
        // The subject is what stands at the head of the same sentence/clause,
        // so look back to the nearest statement boundary.
        const before = source.slice(Math.max(0, at - 200), at);
        const boundary = Math.max(
          before.lastIndexOf('. '),
          before.lastIndexOf('". '),
          before.lastIndexOf('\n'),
          before.lastIndexOf(':'),
        );
        const clause = before.slice(boundary + 1).trim();
        const attributed = APPROVED_ISSUER_SUBJECTS.some((subject) => subject.test(clause));
        expect(
          attributed,
          `${path} predicates a legal role on something other than AJAY GENERAL: ` +
            `"${clause}${match[0]}"`,
        ).toBe(true);
      }
    }
  });

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
    // Ajay General is the legal seller and invoice issuer the owner named. It is
    // NOT described as a registered trade name (registration was never verified)
    // and not as a separate company or legal entity.
    const ajayMentions = [...seed.matchAll(/AJAY GENERAL/g)].length;
    expect(ajayMentions).toBeGreaterThan(0);
    expect(seed).not.toMatch(/AJAY GENERAL is (a|the) (seller|company|legal entity)/i);
    expect(seed).not.toMatch(/registered trade name AJAY GENERAL/i);
    // Maa Kali Enterprises must not be introduced as a seller/issuer anywhere.
    for (const { path, source } of customerFacingSources()) {
      if (!/maa kali/i.test(source)) continue;
      expect(source, path).not.toMatch(/Maa Kali[^.]{0,60}(seller of record|invoice issuer|GST registrant)/i);
    }
  });

  it('says only that Maa Kali Enterprises is a separate business identity', () => {
    // The owner approved exactly one statement about Maa Kali Enterprises: it is
    // a separate business identity. Every stronger reading - that it is legally
    // unrelated, unconnected, owned by someone else, or bound to another entity -
    // is a legal conclusion nobody verified, so no surface may assert it.
    const forbidden = [
      /Maa Kali[^.]{0,120}(not|never)\s+(legally\s+)?(connected|related|associated|affiliated)/i,
      /(not|never)\s+(legally\s+)?(connected|related|associated|affiliated)( to| with)?\s+Maa Kali/i,
      /Maa Kali[^.]{0,120}(owned|operated|controlled|managed)\s+by/i,
      /Maa Kali[^.]{0,120}(is|as)\s+(a|the)\s+(separate|different|distinct)\s+(legal\s+)?(entity|company|business\s+entity\s+of)/i,
    ];
    for (const { path, source } of customerFacingSources()) {
      for (const pattern of forbidden) {
        const match = pattern.exec(source);
        expect(match, `${path} overstates the Maa Kali relationship: "${match?.[0] ?? pattern}"`).toBeNull();
      }
    }
    // And wherever Maa Kali IS mentioned, it is described as a separate business
    // identity - the approved wording - not left as an unexplained name.
    for (const { path, source } of customerFacingSources()) {
      for (const match of source.matchAll(/Maa Kali Enterprises/g)) {
        const window = source.slice(match.index ?? 0, (match.index ?? 0) + 160);
        expect(window, `${path} mentions Maa Kali without the approved description`).toMatch(
          /separate business identity/i,
        );
      }
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

  it('names no grievance officer until the owner supplies the person', () => {
    const seed = read('content/site-pages.seed.json');
    // A grievance officer is a statutory appointment. Naming a person who was
    // never formally appointed would publish a false statutory fact, so the
    // block must say the officer is still to be supplied - and must not be
    // silently empty, because a missing grievance officer is a compliance gap
    // the owner has to see.
    expect(seed).not.toMatch(/Grievance [Oo]fficer:\s*[A-Z]/);
    const placeholders = [
      ...seed.matchAll(/Grievance officer:\s*([^\n"]+)/g),
    ].map((m) => m[1]!.trim());
    expect(placeholders.length).toBeGreaterThan(0);
    for (const placeholder of placeholders) {
      expect(placeholder).toBe('to be supplied by the owner before publication');
    }
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

  it('publishes the approved identity facts and withholds the unverified statutory ones', () => {
    const seed = read('content/site-pages.seed.json');
    for (const approved of [
      'Legal seller and invoice issuer: AJAY GENERAL (proprietorship)',
      'Brand and trading style: MAHARANI TRADERS',
      'Customer-facing app: Maha Bazar by Maharani',
      'AJAY GENERAL is the legal seller and invoice issuer',
      '8987023959',
      'adinathsahu8987@gmail.com',
    ]) {
      expect(seed, approved).toContain(approved);
    }
    // A statutory fact the owner has not verified must never be published, and
    // must never be silently dropped either: each one has an explicit
    // owner-supplied placeholder in the same block.
    for (const unverified of [
      'AJAY KUMAR',
      'Plot No. 231, Ander Bazar, Belaganj, Gaya, Bihar – 804403',
      'Registered trade name: AJAY GENERAL',
      'Grievance Officer: AJAY KUMAR, Proprietor',
    ]) {
      expect(seed, unverified).not.toContain(unverified);
    }
    for (const placeholder of [
      'Proprietor name: to be supplied by the owner before publication',
      'Registered trade name and registration status: to be supplied by the owner before publication',
      'Grievance officer: to be supplied by the owner before publication',
      'Registered address: to be supplied by the owner before publication',
    ]) {
      expect(seed, placeholder).toContain(placeholder);
    }
  });

  it('leaves uncertain text marked for professional review instead of strengthening it', () => {
    const seed = read('content/site-pages.seed.json');
    expect(seed).toMatch(/has not been independently verified|have not been independently verified/);
  });
});
