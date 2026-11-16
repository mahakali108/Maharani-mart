/**
 * Regression guard: a detail page must never turn a FAILED READ into a 404.
 *
 * `notFound()` is a statement about the data ("this row does not exist"). A
 * Supabase read that fails — schema drift (`42703`), an RLS denial, a timeout,
 * an expired session — returns `{ data: null, error }`. Destructuring only
 * `data` made those pages tell the customer "this order was deleted" and the
 * operator "this banner no longer exists", which is false, unactionable, and
 * hid real production faults behind a tidy 404.
 *
 * The contract enforced here:
 *   every page that calls notFound() must
 *     (a) pass a read error to `throwIfReadFailed`, or read a loader's
 *         `errors.*` / `failureMessage` flag, or call a loader that throws
 *         (`fetchDeliveryDetail`, `getSellerDetail`), or
 *     (b) be listed in ALLOWED with a stated reason.
 *
 * Static analysis is the right tool here: the alternative is mounting 30 RSC
 * pages against a Supabase mock, which would prove the mock, not the pages.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '..');

const ERROR_AWARE_MARKERS = [
  'throwIfReadFailed', // lib/supabase/read-guard.ts
  'readFailed(', // boolean variant for pages that render instead of throw
  'failureMessage', // lib/admin/sellers-query.ts contract
  'errors.brand', // lib/retailer/brand-detail.ts flag
  'errors.category', // lib/retailer/category-detail.ts flag
];

/** Loaders that throw on a failed read, so their callers inherit the behaviour. */
const THROWING_LOADERS = [
  'fetchDeliveryDetail',
  'getSellerDetail',
  // Website content editor (0104): loadAdminPage/loadAdminSections/loadAdminNotes/
  // loadPageRevisions call throwIfReadFailed, so notFound() in
  // app/admin/content/[id]/** can only mean a genuinely missing id. Tested in
  // tests/site-content-admin.test.ts ("an unreadable editor read throws").
  'loadAdminPage',
  'loadAdminSections',
  'loadAdminNotes',
  'loadPageRevisions',
];

/**
 * Pages allowed to call notFound() without an error marker.
 * Keep this list short, and never add a page whose 404 can be reached through
 * a failed query.
 */
const ALLOWED = new Map<string, string>([
  [
    'app/legal/[slug]/page.tsx',
    'makes no database query: the slug is looked up in a compiled-in registry, so a 404 can only mean an unknown document',
  ],
  [
    'app/admin/banners/[id]/page.tsx',
    'throws its own Error with the 0074 schema hint before the 404 (see §6.1 of the audit doc)',
  ],
  [
    'app/retailer/categories/[id]/page.tsx',
    'loadCategoryDetail reports a failed taxonomy read as errors.category; the page throws on it',
  ],
  // The three below are owned by OPEN pull requests and this branch must not
  // edit them (PR #107: both retailer order pages; PR #42: the product page).
  // The identical fix is specified, hunk by hunk, in
  // docs/HANDOFF_TO_PR_OWNERS.md and must be applied by those PRs' owners.
  // Listed here rather than silently excluded so the remaining defect is
  // visible in the test suite until it is fixed upstream.
  [
    'app/retailer/orders/[id]/page.tsx',
    'PENDING HANDOFF to PR #107 (file ownership): add throwIfReadFailed(orderError) before notFound()',
  ],
  [
    'app/retailer/orders/[id]/invoice/page.tsx',
    'PENDING HANDOFF to PR #107: PR #107 already throws on orderError, so this closes when #107 merges',
  ],
  [
    'app/retailer/catalog/[id]/page.tsx',
    'PENDING HANDOFF to PR #42 (file ownership): add throwIfReadFailed on the product/pack lookups',
  ],
]);

function pages(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) pages(full, out);
    else if (entry === 'page.tsx') out.push(full);
  }
  return out;
}

describe('detail pages distinguish "missing" from "unreadable"', () => {
  const allPages = pages(join(ROOT, 'app')).map((file) => ({
    file: relative(ROOT, file),
    source: readFileSync(file, 'utf8'),
  }));
  const notFoundPages = allPages.filter((page) => page.source.includes('notFound('));

  it('finds the pages that use notFound()', () => {
    // Guards against the scan silently matching nothing after a refactor.
    expect(notFoundPages.length).toBeGreaterThanOrEqual(25);
  });

  it('every notFound() page is error-aware or explicitly allowed', () => {
    const offenders = notFoundPages
      .filter((page) => !ALLOWED.has(page.file))
      .filter((page) => !ERROR_AWARE_MARKERS.some((marker) => page.source.includes(marker)))
      .filter((page) => !THROWING_LOADERS.some((loader) => page.source.includes(loader)))
      .map((page) => page.file);
    expect(offenders).toEqual([]);
  });

  it('the allow-list never references a page that no longer exists', () => {
    const names = new Set(notFoundPages.map((page) => page.file));
    expect([...ALLOWED.keys()].filter((file) => !names.has(file))).toEqual([]);
  });

  it('the read guard is not imported by a client component', () => {
    const clientFiles = allPages.filter((page) => page.source.startsWith("'use client'"));
    expect(clientFiles.filter((page) => page.source.includes('read-guard'))).toEqual([]);
  });
});
