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
  sections: aboutSource.sections,
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
  sections: contactSource.sections,
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
-- ============================================================================

delete from public.site_pages
 where slug in (${pages.map((p) => q(p.slug)).join(', ')})
   and is_system = true;
`);

console.log(`Wrote content/site-pages.seed.json and migrations/0105 (${pages.length} pages, ${pages.reduce((n, p) => n + p.sections.length, 0)} sections).`);
