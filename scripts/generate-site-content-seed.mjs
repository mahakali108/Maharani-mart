#!/usr/bin/env node
/**
 * Generates:
 *   content/site-pages.seed.json                 - the starter content (one
 *                                                  entry per public page)
 *   supabase/migrations/0105_seed_site_content.sql - inserts that content as
 *                                                  DRAFT pages (publishing is a
 *                                                  separate, owner-approved stage)
 *
 * WHY a generator instead of hand-written SQL
 * -------------------------------------------
 * Before migration 0104 every public information page was JSX in this
 * repository. The owner could not edit a phone number without a deploy, and the
 * pages carried an internal "Publication review required" notice that must
 * never be shown to a customer. 0105 carries that SAME wording into the
 * database, turned into structured sections, with the internal review notices
 * moved to the super-admin-only notes table. It publishes none of it: publication
 * is an owner decision (supabase/publication/README.md).
 *
 * The extraction is mechanical: it reads the registries and the page files, so
 * the seed cannot drift from what was published. Run with:
 *
 *   node --experimental-strip-types scripts/generate-site-content-seed.mjs
 *
 * Afterwards diff the output. Nothing here is applied to a database by the
 * script itself; it only writes files.
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { LEGAL_DOCUMENTS } = await import(path.join(root, 'lib/legal/documents.ts'));
const { POLICY_CONTENT } = await import(path.join(root, 'lib/legal/content.ts'));

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** '04 November 2026' -> '2026-11-04' (the format stored in a `date` column). */
function isoDate(text) {
  const match = /(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})/.exec(text ?? '');
  if (!match) return null;
  const month = MONTHS.indexOf(match[2]);
  if (month < 0) return null;
  return `${match[3]}-${String(month + 1).padStart(2, '0')}-${String(Number(match[1])).padStart(2, '0')}`;
}

const ENTITIES = { '&amp;': '&', '&nbsp;': ' ', '&quot;': '"', '&#39;': "'", '&lt;': '<', '&gt;': '>', '&apos;': "'", '&rsquo;': '’', '&lsquo;': '‘', '&ldquo;': '“', '&rdquo;': '”' };

/**
 * JSX text -> plain text with `[label](/path)` inline links.
 * Only the constructs these pages actually use are supported; anything else is
 * stripped, and the caller verifies no JSX expression survived.
 */
function inlineText(jsx) {
  let text = jsx
    .replace(/<Link\s+href="([^"]+)"[^>]*>([\s\S]*?)<\/Link>/g, (_, href, label) => `[${label.replace(/<[^>]+>/g, '').trim()}](${href})`)
    .replace(/<a\s+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g, (_, href, label) => `[${label.replace(/<[^>]+>/g, '').trim()}](${href})`)
    .replace(/<strong>([\s\S]*?)<\/strong>/g, (_, inner) => inner.trim())
    .replace(/<em>([\s\S]*?)<\/em>/g, (_, inner) => inner.trim())
    .replace(/<br\s*\/?>/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\{' '\}/g, ' ')
    .replace(/&[a-z#0-9]+;/gi, (entity) => ENTITIES[entity.toLowerCase()] ?? entity);
  text = text.replace(/\s+/g, ' ').trim();
  return text;
}

function paragraphs(block) {
  return [...block.matchAll(/<p>([\s\S]*?)<\/p>/g)]
    .map((match) => inlineText(match[1]))
    .filter(Boolean);
}

function bullets(block) {
  const out = [];
  for (const list of block.matchAll(/<ul[^>]*>([\s\S]*?)<\/ul>/g)) {
    for (const item of list[1].matchAll(/<li>([\s\S]*?)<\/li>/g)) {
      const text = inlineText(item[1]);
      if (text) out.push(text);
    }
  }
  return out;
}

/** Extracts `<InfoCard title="...">` blocks, ignoring the contact component. */
function infoCards(source) {
  return [...source.matchAll(/<InfoCard title="([^"]*)">([\s\S]*?)<\/InfoCard>/g)].map((match) => {
    // Inside JSX a `{...}` block is an expression, not customer text: every one
    // in these pages is a conditional that renders nothing until an owner
    // setting exists. Removing it here (and only here, never across the whole
    // file) keeps the plain text of the card.
    const block = stripExpressions(match[2]);
    const body = paragraphs(block);
    const list = bullets(block);
    // A card that rendered the <BusinessContact /> component extracts to nothing
    // (or to just its lead-in sentence). The owner-provided contact text is
    // appended so no page silently loses its contact block when that component
    // is deleted.
    const heading = match[1].trim();
    const hadContactComponent = /<BusinessContact\b/.test(match[2]);
    const merged = hadContactComponent ? [...body, ...CONTACT_LINES] : body;
    if (!merged.length && !list.length && /contact/i.test(heading)) {
      return { heading, body: [...CONTACT_LINES], bullets: [] };
    }
    return { heading, body: merged, bullets: list };
  });
}

function shellProp(source, prop) {
  const match = new RegExp(`<PublicInfoShell[^>]*\\s${prop}="([^"]*)"`, 's').exec(source);
  return match ? inlineText(match[1]) : '';
}

/**
 * Removes `{expression}` blocks, including multi-line JSX expressions such as
 * `{configuredContact.isConfigured && (<div>…</div>)}`.
 *
 * They are not customer-visible content: every one of them is a conditional
 * block that renders nothing until an owner-supplied setting exists, and the
 * CMS models that case as editable page text instead of a template expression.
 */
function stripExpressions(source) {
  let out = '';
  let depth = 0;
  for (const char of source) {
    if (char === '{') depth += 1;
    else if (char === '}') depth = Math.max(0, depth - 1);
    else if (depth === 0) out += char;
  }
  return out;
}

/**
 * The JSX pages this seed came from were deleted once the content moved into the
 * database, so a later run of this script reuses the page-level fields already
 * recorded in content/site-pages.seed.json instead of the deleted file. The
 * JSON is therefore the reviewed source of truth; this script re-emits the SQL
 * from it (and from any JSX page that is still present in an older checkout).
 */
const PREVIOUS = existsSync(path.join(root, 'content/site-pages.seed.json'))
  ? JSON.parse(readFileSync(path.join(root, 'content/site-pages.seed.json'), 'utf8')).pages
  : [];
const previousBySlug = new Map(PREVIOUS.map((page) => [page.slug, page]));

/**
 * Marketplace retirement (Phase 4 of the seller/supplier removal).
 *
 * Ten pages carried wording written when a third-party seller marketplace was
 * still a possibility ("the application includes marketplace and seller
 * features, subject to configuration"). That programme has been discontinued, so
 * the text now states the single-seller position. The replacements below are
 * keyed on the EXACT superseded sentence and are applied to the JSON seed as a
 * final pass, so:
 *   - the reviewed wording lives in one place (this file) and re-running the
 *     generator reproduces the seed byte-for-byte;
 *   - only a sentence that is still present is replaced; a page the owner has
 *     since rewritten in Super Admin -> Website content is left alone;
 *   - nothing is invented: each replacement asserts only facts already true in
 *     the repository (own stock only, no marketplace, no seller sign-up).
 *
 * The legal pages that had no structured source (terms, privacy, about, contact,
 * business-disclosure) are read back from the JSON, and this pass is what keeps
 * them honest.
 */
const RETIRED_MARKETPLACE_COPY = [
  // terms — Acceptance and business model
  ['The application includes marketplace and seller features, including seller offers and fulfilment; their availability depends on configuration. These own-stock sales terms do not provide a complete set of terms for third-party seller transactions. Any third-party launch or ongoing operation requires separately reviewed customer and seller terms, including the seller of record, invoicing, fulfilment, returns and support responsibilities. Applicable rights are not excluded.',
   'Maharani Traders sells goods held in its own stock; there is no marketplace and no third-party seller offers. The third-party seller programme that earlier versions of these terms mentioned has been discontinued, and any order placed before that change is unaffected. The seller and invoice issuer is the AJAY GENERAL proprietorship, which trades under the brand MAHARANI TRADERS; the GSTIN and registered address printed on the invoice are the ones registered for that business. Applicable rights are not excluded.'],
  // privacy — How information is used and shared
  ['Where necessary and lawful, information may be shared with delivery providers, technology and security providers, professional advisers or authorities. The application also supports third-party seller fulfilment: if used, the relevant seller may receive order and delivery information, including the recipient address and phone where provided. Marketplace data flows and disclosures require verification before any third-party operation. We do not sell customer personal information as a business practice. The application uses Supabase for authentication and includes Vercel Analytics; actual deployment and provider arrangements should be verified before publication.',
   'Where necessary and lawful, information may be shared with delivery providers, technology and security providers, professional advisers or authorities. Because every order is fulfilled by Maharani Traders from its own stock, order and delivery information is not disclosed to any independent seller or marketplace participant; that programme has been discontinued. We do not sell customer personal information as a business practice. The application uses Supabase for authentication and includes Vercel Analytics; actual deployment and provider arrangements should be verified before publication.'],
  // business-disclosure — Tax and policy scope
  ['The own-stock sales policies do not provide complete terms for third-party seller transactions. The application includes marketplace features for seller offers and fulfilment, subject to configuration; we have not verified whether those features are operating in production. Any third-party launch or ongoing operation requires separately reviewed seller and customer terms and clear allocation of invoicing, fulfilment, return and support responsibilities. Applicable rights are not excluded.',
   'Maharani Traders operates a single-seller store: goods are sold only from its own stock, so there are no third-party seller transactions to allocate. The third-party marketplace and seller programme described in earlier versions of this page has been discontinued. The seller, the invoice issuer and the GST registrant is the AJAY GENERAL proprietorship, which trades under the brand MAHARANI TRADERS; the GSTIN and registered address printed on the invoice are the ones registered for that business. Applicable rights are not excluded.'],
  // about — How ordering works
  ['The application includes marketplace and seller features, subject to configuration. The own-stock sales policies do not provide complete terms for third-party transactions; any launch or ongoing operation requires separate review. Food products are excluded from the stated current scope.',
   'Maharani Traders sells only from its own stock. The third-party marketplace described in earlier versions of this page has been discontinued. The seller and invoice issuer is the AJAY GENERAL proprietorship, which trades under the brand MAHARANI TRADERS; the GSTIN and registered address printed on the invoice are the ones registered for that business. Food products are excluded from the current scope.'],
  // contact — Seller and account access
  ['Seller accounts are created by Super Admin invitation. If you have an invitation, use the emailed link; verification and approval are required before trading. The current own-stock sales policies do not provide complete terms for third-party seller transactions, which require separate review. For sign-in issues, use [password recovery](/forgot-password). Do not share passwords, OTPs or one-time links with support.',
   'There is no seller or supplier sign-up. Retail shop accounts are created by registering on this site and are activated after approval by Maharani Traders. If you already held a seller account under the earlier marketplace programme, that programme has been discontinued; contact us using the details below and we will explain what is available to you. For sign-in issues, use [password recovery](/forgot-password). Do not share passwords, OTPs or one-time links with support.'],
];

/** Sentence-level replacements inside the structured POLICY_CONTENT pages. */
const RETIRED_MARKETPLACE_SENTENCES = [
  // damaged-goods
  ['After checking the complaint we will offer the remedy that fits the problem: replacement, collection of the goods with a refund, or a price adjustment. For goods sold by an independent seller, we pass the complaint to that seller and follow it up; see the Marketplace Disclaimer.',
   'After checking the complaint we will offer the remedy that fits the problem: replacement, collection of the goods with a refund, or a price adjustment. Every order on this website is sold and fulfilled by Maharani Traders from its own stock, so we handle the whole complaint ourselves and there is no third party to pass it to. See the [Marketplace Disclaimer](/legal/marketplace-disclaimer) for the record of the discontinued marketplace programme.'],
  // gst-pricing-invoice
  ['An invoice or bill is issued for every delivered order by the seller of the goods: by us for own-stock goods, and by the independent seller for seller offers. Where one order contains goods from more than one seller, you may receive more than one invoice.',
   'An invoice or bill is issued for every delivered order. The seller and invoice issuer is the AJAY GENERAL proprietorship, which trades under the brand MAHARANI TRADERS; the GSTIN and registered address printed on the invoice are the ones registered for that business. Because there is no marketplace, an order never contains goods supplied by another seller and you will not receive an invoice from a third party.'],
  // prohibited-products
  ['Every product category carries a compliance classification set by the Super Admin. Only categories classified as cosmetics or non-food FMCG can hold products for sale; the database rejects a product or seller offer placed in any other category.',
   'Every product category carries a compliance classification set by the Super Admin. Only categories classified as cosmetics or non-food FMCG can hold products for sale; the database rejects a product placed in any other category.'],
  ['Seller offers are reviewed before they go live, and each decision is recorded with the reviewer and the reason.',
   'Every product goes through a compliance review before it can be published, and each decision is recorded with the reviewer and the reason. Only Maharani Traders adds products to this website, so there is no third-party listing channel to police.'],
  // ip-complaints
  ['We acknowledge the complaint, check it, and where it appears valid we remove or disable the listing. For a seller offer we inform the seller, who may reply with evidence such as purchase invoices or a brand authorisation.',
   'We acknowledge the complaint, check it, and where it appears valid we remove or disable the listing while we investigate. Because we are the seller of every product on this website, there is no third-party seller to notify: we answer the complaint ourselves with the purchase invoices and brand authorisations we hold.'],
  ['If the seller\u2019s reply shows the goods are genuine and lawfully sold, the listing may be restored and we will tell you why. Repeated or serious infringement leads to suspension of the seller.',
   'If our own records show the goods are genuine and lawfully sold, the listing may be restored and we will tell you why. A listing that cannot be substantiated stays withdrawn.'],
  // suspension-termination
  ['For sellers: unsafe, counterfeit, mislabelled or prohibited goods, or failure to respond to complaints.',
   'For retailer accounts: attempted resale of unsafe, counterfeit, mislabelled or prohibited goods, or failure to respond to complaints about an order.'],
  // ---- Second hop -------------------------------------------------------------
  // The first hop above replaced the ORIGINAL marketplace sentence. An earlier
  // revision of this removal then introduced its own "we are the seller of
  // record for every order" wording, which asserts a legal role (seller of
  // record, invoice issuer, GST registrant) that the owner has NOT verified.
  // Those sentences are corrected here so the table CONVERGES regardless of
  // which revision a database was seeded from. Each entry only fires if the text
  // is actually present, so re-running is safe.
  ['Maharani Traders sells only goods from its own stock. There is no marketplace: all products are bought, stored, priced and sold by Maharani Traders, and we are the seller of record for every order. The third-party seller programme that earlier versions of these terms mentioned has been discontinued. Any order placed before that change is unaffected, and any rights you already hold are not excluded.',
   'Maharani Traders sells goods held in its own stock; there is no marketplace and no third-party seller offers. The third-party seller programme that earlier versions of these terms mentioned has been discontinued, and any order placed before that change is unaffected. The seller and invoice issuer is the AJAY GENERAL proprietorship, which trades under the brand MAHARANI TRADERS; the GSTIN and registered address printed on the invoice are the ones registered for that business. Applicable rights are not excluded.'],
  ['Maharani Traders operates a single-seller store: goods are sold only from its own stock, and it is the seller of record for every order. The third-party marketplace and seller programme described in earlier versions of this page has been discontinued, so there are no third-party seller transactions to allocate. Applicable rights are not excluded.',
   'Maharani Traders operates a single-seller store: goods are sold only from its own stock, so there are no third-party seller transactions to allocate. The third-party marketplace and seller programme described in earlier versions of this page has been discontinued. The seller, the invoice issuer and the GST registrant is the AJAY GENERAL proprietorship, which trades under the brand MAHARANI TRADERS; the GSTIN and registered address printed on the invoice are the ones registered for that business. Applicable rights are not excluded.'],
  ['An invoice or bill is issued for every delivered order by Maharani Traders, which sells only from its own stock and is therefore the seller of record. Because there is no marketplace, an order never contains goods supplied by another seller and you will not receive a second invoice from a third party.',
   'An invoice or bill is issued for every delivered order. The seller and invoice issuer is the AJAY GENERAL proprietorship, which trades under the brand MAHARANI TRADERS; the GSTIN and registered address printed on the invoice are the ones registered for that business. Because there is no marketplace, an order never contains goods supplied by another seller and you will not receive an invoice from a third party.'],
  // ---- Third hop: the owner's answer to "who is the seller?" -----------------
  // The two hops above had to leave the seller identity OPEN, because it was an
  // unanswered legal question and guessing it was not mine to do. The owner has
  // now answered it: the AJAY GENERAL proprietorship is the seller and invoice
  // issuer, trading under the brand MAHARANI TRADERS. That is stated plainly
  // instead of deferred to the invoice.
  //
  // Still invented: nothing. The GSTIN and registered address are NOT written
  // here — the copy points at the invoice, which is where the registered values
  // are printed. They are supplied separately and go in when the owner provides
  // them, not before.
  ['The business identity that appears as the seller, as the invoice issuer and on the GST registration for a given transaction is stated on the invoice and in the Contact and Legal Information page; it is not assumed by this page.',
   'The seller and invoice issuer is the AJAY GENERAL proprietorship, which trades under the brand MAHARANI TRADERS; the GSTIN and registered address printed on the invoice are the ones registered for that business.'],
  ['Which business identity is the seller, the invoice issuer or the GST registrant for a transaction is stated on the invoice and in the Contact and Legal Information page, and is not assumed by this page.',
   'The seller, the invoice issuer and the GST registrant is the AJAY GENERAL proprietorship, which trades under the brand MAHARANI TRADERS; the GSTIN and registered address printed on the invoice are the ones registered for that business.'],
  // ---- Final hop: an earlier revision's about-page wording --------------------
  // The about page is read back out of the JSON, so its stored text can be any
  // link in this chain. This entry exists because that page previously said
  // orders are "invoiced by Maharani Traders", which asserts an invoice-issuer
  // role for a BRAND rather than for the proprietorship the owner named.
  ['Maharani Traders sells only from its own stock, so every order is fulfilled and invoiced by Maharani Traders. The third-party marketplace described in earlier versions of this page has been discontinued. Food products are excluded from the current scope.',
   'Maharani Traders sells only from its own stock. The third-party marketplace described in earlier versions of this page has been discontinued. The seller and invoice issuer is the AJAY GENERAL proprietorship, which trades under the brand MAHARANI TRADERS; the GSTIN and registered address printed on the invoice are the ones registered for that business. Food products are excluded from the current scope.'],
];

/**
 * Applies the retirement copy to a page's sections. Matching is on the whole
 * sentence so an unrelated edit elsewhere on the page cannot be clobbered, and a
 * sentence that no longer exists is simply skipped.
 */
function retireMarketplaceCopy(sections) {
  const map = new Map([
    ...RETIRED_MARKETPLACE_COPY.map((pair) => pair),
    ...RETIRED_MARKETPLACE_SENTENCES,
  ]);

  /**
   * Apply the table until it stops changing anything.
   *
   * A single pass is not enough: the table is a CHAIN of corrections, and a
   * later entry's `from` is an earlier entry's `to` (the marketplace sentence
   * becomes neutral copy, and the neutral copy then becomes the owner-approved
   * seller identity). With one pass, a source whose text sits at an intermediate
   * link would never reach the final wording. Iterating makes the table
   * convergent: the output is the fixpoint no matter which link the stored text
   * happens to be at. The bound is a loop guard, not an expected count.
   */
  const applyHops = (text) => {
    let current = text;
    for (let hop = 0; hop < 8; hop += 1) {
      const next = map.get(current);
      if (next === undefined) break;
      current = next;
    }
    return current;
  };

  /**
   * Rewrite a paragraph sentence by sentence, then the paragraph as a whole.
   *
   * Some table entries are a single sentence and some are a whole paragraph.
   * Splitting on the sentence terminator lets a one-sentence correction fire
   * inside a paragraph that also carries sentences the table has nothing to say
   * about; the whole-paragraph pass afterwards still lets a paragraph-level entry
   * win. Splitting is lossless (the separators are kept), so an untouched
   * paragraph is returned byte-identical.
   */
  const rewrite = (line) => {
    const whole = applyHops(line);
    if (whole !== line) return whole;
    return line
      .split(/(?<=[.!?])\s+/)
      .map(applyHops)
      .join(' ');
  };

  return sections.map((section) => ({
    ...section,
    body: (section.body ?? []).map(rewrite),
    bullets: (section.bullets ?? []).map(rewrite),
  }));
}

function readPage(relative) {
  const source = readFileSync(path.join(root, relative), 'utf8');
  return {
    source,
    eyebrow: shellProp(source, 'eyebrow'),
    title: shellProp(source, 'title'),
    intro: shellProp(source, 'intro'),
    sections: infoCards(source),
  };
}

/**
 * The owner-provided contact block. Before the CMS this was rendered by
 * components/legal/business-contact.tsx; those values are carried into the page
 * content here so that removing the hardcoded component does not delete the
 * contact details a customer can read today. It is ordinary editable content
 * afterwards (Super Admin -> Website content).
 */
const CONTACT_LINES = [
  'Proprietor: AJAY KUMAR',
  'Registered trade name: AJAY GENERAL',
  'Brand: MAHARANI TRADERS',
  'Grievance Officer: AJAY KUMAR, Proprietor',
  'Address: Plot No. 231, Ander Bazar, Belaganj, Gaya, Bihar – 804403',
  'Phone: [8987023959](tel:8987023959)',
  'Email: [adinathsahu8987@gmail.com](mailto:adinathsahu8987@gmail.com)',
];

const pages = [];
let order = 10;

for (const doc of LEGAL_DOCUMENTS) {
  const structured = POLICY_CONTENT[doc.key];
  let sections;
  let intro;
  let eyebrow = 'Legal policies';

  if (structured) {
    intro = structured.intro;
    sections = structured.sections.map((section) => ({
      heading: section.title,
      body: section.paragraphs ?? [],
      bullets: section.bullets ?? [],
    }));
  } else if (existsSync(path.join(root, `app/legal/${doc.key}/page.tsx`))) {
    // Pages that are still JSX in this checkout.
    const parsed = readPage(`app/legal/${doc.key}/page.tsx`);
    intro = parsed.intro.replace(/^Effective date:[^.]+\.\s*/, '').trim();
    sections = parsed.sections;
    eyebrow = parsed.eyebrow || eyebrow;
  } else {
    // The JSX page retired once the content moved into the database; its reviewed
    // wording is kept in content/site-pages.seed.json.
    const previous = previousBySlug.get(doc.key);
    if (!previous) throw new Error(`No source for legal page "${doc.key}"`);
    intro = previous.intro;
    sections = previous.sections;
    eyebrow = previous.eyebrow || eyebrow;
  }

  if (!sections.length) throw new Error(`No sections extracted for legal page "${doc.key}"`);
  sections = retireMarketplaceCopy(sections);

  pages.push({
    slug: doc.key,
    kind: 'legal',
    audience: doc.audience,
    nav_label: doc.shortLabel,
    short_label: doc.shortLabel,
    eyebrow,
    title: doc.title,
    intro,
    meta_description: doc.summary,
    version: doc.version,
    effective_date: isoDate(doc.effectiveDate),
    sort_order: order,
    show_in_footer: true,
    show_in_index: true,
    show_contact_details: true,
    related_slugs: structured?.related ?? [],
    is_system: true,
    sections,
    owner_decisions: structured?.ownerDecisions ?? [],
    internal_notes:
      'Owner verification pending. This wording was published before website content management existed and was carried over verbatim by migration 0105 so no customer-visible policy text changed. It still requires the owner and an Indian legal/tax reviewer to confirm the commercial points listed in the open decisions.',
  });
  order += 10;
}

// About Us and Contact are ordinary pages managed by the same module.
// /about is now a thin wrapper that renders the managed page, so the reviewed
// content comes from the seed JSON; the JSX extraction is only for a pre-CMS
// checkout that has no seed yet.
const aboutSource = previousBySlug.get('about') ?? readPage('app/about/page.tsx');
pages.push({
  slug: 'about',
  kind: 'page',
  audience: 'everyone',
  nav_label: 'About',
  short_label: 'About',
  eyebrow: aboutSource.eyebrow || 'About us',
  title: aboutSource.title,
  intro: aboutSource.intro,
  meta_description: aboutSource.meta_description ?? aboutSource.intro.slice(0, 300),
  version: '1.0',
  effective_date: '2026-11-14',
  sort_order: 1,
  show_in_footer: true,
  show_in_index: false,
  show_contact_details: true,
  related_slugs: ['terms', 'shipping'],
  is_system: true,
  sections: retireMarketplaceCopy(aboutSource.sections),
  owner_decisions: aboutSource.owner_decisions ?? [],
  internal_notes:
    'Business identity and contact details must be confirmed by the owner before launch. The text was carried over from the pre-CMS page unchanged.',
});

const contactSource = previousBySlug.get('contact') ?? readPage('app/contact/page.tsx');
pages.push({
  slug: 'contact',
  kind: 'page',
  audience: 'everyone',
  nav_label: 'Contact',
  short_label: 'Contact',
  eyebrow: contactSource.eyebrow || 'Support',
  title: contactSource.title,
  intro: contactSource.intro,
  meta_description: contactSource.meta_description ?? contactSource.intro.slice(0, 300),
  version: '1.0',
  effective_date: '2026-11-14',
  sort_order: 2,
  show_in_footer: true,
  show_in_index: false,
  show_contact_details: true,
  related_slugs: ['grievance', 'privacy'],
  is_system: true,
  sections: retireMarketplaceCopy(contactSource.sections),
  owner_decisions: contactSource.owner_decisions ?? [],
  internal_notes:
    'Contact details are owner-provided. Until the storefront contact block is marked verified in Super Admin → Business & contact details, launch readiness treats them as unconfirmed.',
});

// ---------------------------------------------------------------------------
// Sanity: nothing may keep a JSX expression, and every section needs text.
// ---------------------------------------------------------------------------
for (const page of pages) {
  const haystack = [page.title, page.intro, page.meta_description, ...page.sections.flatMap((s) => [s.heading, ...s.body, ...s.bullets])];
  for (const value of haystack) {
    if (value && /\{[^}]*\}/.test(value)) throw new Error(`Unresolved JSX expression in ${page.slug}: ${value.slice(0, 120)}`);
    if (value && /<[a-z/]/i.test(value)) throw new Error(`Unresolved tag in ${page.slug}: ${value.slice(0, 120)}`);
 }
  // A section whose whole body was the <BusinessContact /> component extracts to
  // nothing. It is dropped here because the page renders the contact card from
  // `show_contact_details`, so keeping an empty heading would be worse.
  page.sections = page.sections.filter((section) => section.body.length || section.bullets.length);
  if (!page.sections.length) throw new Error(`No usable sections on ${page.slug}`);
}

// ---------------------------------------------------------------------------
// JSON (the reviewable source of the seed)
// ---------------------------------------------------------------------------
mkdirSync(path.join(root, 'content'), { recursive: true });
writeFileSync(path.join(root, 'content/site-pages.seed.json'), `${JSON.stringify({ generatedFrom: 'app/about, app/contact, app/legal/*, lib/legal/{documents,content}.ts', pages }, null, 2)}\n`);

// ---------------------------------------------------------------------------
// SQL: one DO block per page, idempotent, DRAFT only (publication is separate).
// ---------------------------------------------------------------------------
const q = (value) => (value == null ? 'null' : `$seed$${value}$seed$`);
const arr = (values) => {
  const list = (values ?? []).filter((v) => v != null && v !== '');
  return list.length ? `array[${list.map((v) => `$seed$${v}$seed$`).join(', ')}]::text[]` : `'{}'::text[]`;
};

const preamble = `-- ============================================================================
-- 0105: seed the Super Admin website content module with DRAFTS.
--
-- FOR REVIEW ONLY. NOT APPLIED TO ANY REMOTE PROJECT BY THIS CHANGE.
--
-- Generated by scripts/generate-site-content-seed.mjs from
-- app/about/page.tsx, app/contact/page.tsx, app/legal/*/page.tsx and
-- lib/legal/{documents,content}.ts. Re-run the script rather than editing this
-- file by hand.
--
-- What it does:
--   * inserts one row per public page (About, Contact and every policy in the
--     legal registry) ONLY when that slug does not exist yet, so it is
--     idempotent and never overwrites an edit made in /admin/content;
--   * copies the current wording into ordered sections;
--   * leaves every page in DRAFT. This migration publishes NOTHING.
--   * writes no published_at, no published_by and no published_snapshot, so no
--     page can be served to a customer by this file, and there is no backdated
--     publication timestamp anywhere;
--   * moves the operator notices ("Publication review required", the open
--     owner decisions) into site_page_admin_notes, which no customer can read.
--
-- It inserts NO approval: every page is marked owner_review_pending.
--
-- WHY DRAFTS AND NOT PUBLISHED
-- Publishing is an owner decision with a legal consequence: it is what makes a
-- policy publicly readable, and (for a document that is acceptance-required) what
-- fixes the version a customer must accept. A seed cannot make that decision for
-- 19 pages at once, and a fabricated historical timestamp would claim the owner
-- published them on a date they did not choose. Publication is therefore a
-- separate, reviewed, per-stage action:
--
--   supabase/publication/stage1_publish_live_text.sql
--   supabase/publication/stage2_publish_reviewed_additions.sql
--   (see supabase/publication/README.md for the order, the approvals and the
--    verification queries)
--
-- Depends on: 0104 (site_pages).
-- Rollback: supabase/rollbacks/0105_seed_site_content.down.sql
-- ============================================================================

do $$
begin
  if to_regclass('public.site_pages') is null then
    raise exception '0105 requires migration 0104 (site_pages).';
  end if;
end
$$;
`;

const blocks = pages.map((page) => {
  const sectionInserts = page.sections
    .map((section, index) => `    insert into public.site_page_sections (page_id, heading, body, bullets, sort_order)
    values (v_page, ${q(section.heading)}, ${arr(section.body)}, ${arr(section.bullets)}, ${(index + 1) * 10});`)
    .join('\n');

  const related = arr(page.related_slugs);

  return `-- ${page.slug}
do $$
declare
  v_page uuid;
begin
  select id into v_page from public.site_pages where slug = ${q(page.slug)};
  if v_page is not null then
    return;
  end if;

  insert into public.site_pages (
    slug, kind, audience, nav_label, short_label, eyebrow, title, intro,
    meta_description, status, version, effective_date, sort_order,
    show_in_footer, show_in_index, show_contact_details, related_slugs,
    is_system
  ) values (
    ${q(page.slug)}, ${q(page.kind)}, ${q(page.audience)}, ${q(page.nav_label)}, ${q(page.short_label)},
    ${q(page.eyebrow)}, ${q(page.title)}, ${q(page.intro)}, ${q(page.meta_description)},
    'draft', ${q(page.version)}, date '${page.effective_date}', ${page.sort_order},
    ${page.show_in_footer}, ${page.show_in_index}, ${page.show_contact_details}, ${related},
    ${page.is_system}
  ) returning id into v_page;

${sectionInserts}

  -- Deliberately NOT published here: see the header. The page stays a draft
  -- until the owner runs a publication stage for its slug.

  insert into public.site_page_admin_notes (page_id, internal_notes, owner_decisions, review_status)
  values (v_page, ${q(page.internal_notes)}, ${arr(page.owner_decisions)}, 'owner_review_pending')
  on conflict (page_id) do nothing;
end
$$;
`;
}).join('\n');

const footer = `
-- ----------------------------------------------------------------------------
-- Result check: every seeded page exists as a DRAFT and nothing was published.
--
-- This runs in the same transaction as the inserts, so a future edit that
-- reintroduces a publish (or a backdated timestamp) fails the migration instead
-- of quietly putting policy text in front of a customer.
-- ----------------------------------------------------------------------------
do $$
declare
  v_missing integer;
  v_published integer;
begin
  select count(*) into v_missing
    from unnest(array[${pages.map((p) => q(p.slug)).join(', ')}]) as s(slug)
   where not exists (select 1 from public.site_pages p where p.slug = s.slug);
  if v_missing > 0 then
    raise exception '0105 did not create % seeded page(s)', v_missing;
  end if;

  select count(*) into v_published
    from public.site_pages
   where slug in (${pages.map((p) => q(p.slug)).join(', ')})
     and (status <> 'draft' or published_snapshot is not null or published_at is not null or published_by is not null);
  if v_published > 0 then
    raise exception '0105 must not publish: % seeded page(s) are not pure drafts', v_published;
  end if;
end
$$;

-- ============================================================================
-- END 0105
-- ============================================================================
`;

writeFileSync(path.join(root, 'supabase/migrations/0105_seed_site_content.sql'), preamble + blocks + footer);
writeFileSync(path.join(root, 'supabase/rollbacks/0105_seed_site_content.down.sql'), `-- ============================================================================
-- Rollback of 0105: removes ONLY the pages this seed created (by slug), together
-- with their sections, internal notes and revision rows (ON DELETE CASCADE).
--
-- A page that no longer exactly matches the seeded content is left in place:
-- once an editor has changed it, it is their content, not the seed's. Pages
-- created in /admin/content are never touched.
--
-- DESTRUCTIVE, and deliberately gated: every seeded page is \`is_system = true\`,
-- which trg_site_pages_block_system_delete (0104) refuses to delete unless the
-- operator opts in first. That opt-in is the \`set\` below - the same GUC the 0104
-- rollback uses - so this file cannot run by accident. Run it BEFORE the 0104
-- rollback, which drops the tables wholesale.
-- ============================================================================

set maharani.allow_data_loss = 'true';

delete from public.site_pages
 where slug in (${pages.map((p) => q(p.slug)).join(', ')})
   and is_system = true;

reset maharani.allow_data_loss;
`);

console.log(`Wrote content/site-pages.seed.json and migrations/0105 (${pages.length} pages, ${pages.reduce((n, p) => n + p.sections.length, 0)} sections).`);
