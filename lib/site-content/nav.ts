import 'server-only';

import { loadPublishedPages } from './queries';
import type { FooterLink, PublishedPageSummary } from './types';

/**
 * Footer navigation derived from the managed website content (migration 0104).
 *
 * Every footer in the app — public, retailer, seller, staff, salesman, admin and
 * the sign-in frame — renders this list instead of a hand-maintained array, so
 * renaming a page or withholding it from the footer is a Super Admin action in
 * /admin/content, not a code change. Adding a page to the seed therefore needs
 * no footer edit, and unpublishing one removes its link without a deploy.
 *
 * `FALLBACK_FOOTER_LINKS` is navigation only — it carries no business detail and
 * no policy text. It is used when `published_pages()` cannot be read at all
 * (database unreachable, migration not yet applied). Even then every address is
 * safe to click: a page that is not published renders the clean
 * "This page is not available right now." state, never a draft.
 */
export const FALLBACK_FOOTER_LINKS: FooterLink[] = [
  { href: '/about', label: 'About' },
  { href: '/legal/terms', label: 'Terms' },
  { href: '/legal/privacy', label: 'Privacy' },
  { href: '/legal/shipping', label: 'Delivery' },
  { href: '/legal/returns', label: 'Returns' },
  { href: '/legal/grievance', label: 'Grievance' },
  { href: '/legal/product-safety', label: 'Product safety' },
  { href: '/legal/business-disclosure', label: 'Business disclosure' },
  { href: '/contact', label: 'Contact' },
  { href: '/legal', label: 'All policies' },
];

/** The public address of a managed page. Legal pages live under /legal/. */
export function pageHref(slug: string, kind: 'page' | 'legal'): string {
  return kind === 'legal' ? `/legal/${slug}` : `/${slug}`;
}

/**
 * The single mapping from published pages to navigation. Used by the site-wide
 * footers (`loadFooterLinks`) and by the public information shell, so a page
 * cannot appear under one label in a footer and another on a policy page.
 */
export function footerLinksFromPages(pages: readonly PublishedPageSummary[]): FooterLink[] {
  const links: FooterLink[] = [];
  const seen = new Set<string>();
  for (const page of pages.filter((entry) => entry.show_in_footer && entry.slug.length > 0)) {
    const href = pageHref(page.slug, page.kind);
    if (seen.has(href)) continue;
    seen.add(href);
    links.push({ href, label: page.short_label ?? page.nav_label });
  }
  return links;
}

export async function loadFooterLinks(): Promise<FooterLink[]> {
  const pages = await loadPublishedPages();
  if (pages.length === 0) return FALLBACK_FOOTER_LINKS;

  const ordered = [...pages].sort(
    (a, b) => a.sort_order - b.sort_order || a.nav_label.localeCompare(b.nav_label),
  );
  const links = footerLinksFromPages(ordered);

  // The policy index is a route of its own (app/legal/page.tsx), not a stored
  // page, so it is the one entry this module adds rather than reads.
  if (!links.some((link) => link.href === '/legal')) links.push({ href: '/legal', label: 'All policies' });
  return links;
}
