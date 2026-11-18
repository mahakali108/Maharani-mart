import { describe, expect, it } from 'vitest';

import { FALLBACK_FOOTER_LINKS, footerLinksFromPages, pageHref } from '@/lib/site-content/nav';
import type { PublishedPageSummary } from '@/lib/site-content/types';
import { can, permissionsForRole } from '@/lib/permissions/permissions';
import type { UserRole } from '@/lib/auth/roles';

function summary(overrides: Partial<PublishedPageSummary> & { slug: string }): PublishedPageSummary {
  return {
    kind: 'legal',
    audience: 'everyone',
    nav_label: overrides.slug,
    short_label: null,
    title: overrides.slug,
    summary: null,
    version: '1.0',
    effective_date: '2026-11-15',
    sort_order: 0,
    show_in_footer: true,
    show_in_index: true,
    ...overrides,
  };
}

describe('footer navigation comes from managed content', () => {
  it('addresses legal pages under /legal and ordinary pages at the root', () => {
    expect(pageHref('terms', 'legal')).toBe('/legal/terms');
    expect(pageHref('about', 'page')).toBe('/about');
  });

  it('maps only footer-visible published pages, preferring the short label', () => {
    const links = footerLinksFromPages([
      summary({ slug: 'terms', short_label: 'Terms' }),
      summary({ slug: 'privacy', nav_label: 'Privacy Policy', short_label: null }),
      summary({ slug: 'about', kind: 'page', nav_label: 'About Us' }),
      summary({ slug: 'internal', show_in_footer: false }),
    ]);
    expect(links).toEqual([
      { href: '/legal/terms', label: 'Terms' },
      { href: '/legal/privacy', label: 'Privacy Policy' },
      { href: '/about', label: 'About Us' },
    ]);
  });

  it('never renders a duplicate address, and an empty list renders nothing', () => {
    const links = footerLinksFromPages([
      summary({ slug: 'terms' }),
      summary({ slug: 'terms', nav_label: 'Duplicate' }),
    ]);
    expect(links).toHaveLength(1);
    expect(footerLinksFromPages([])).toEqual([]);
  });

  it('keeps a navigation-only fallback that names no business detail or policy text', () => {
    const hrefs = FALLBACK_FOOTER_LINKS.map((link) => link.href);
    for (const href of [
      '/legal/terms',
      '/legal/privacy',
      '/legal/shipping',
      '/legal/returns',
      '/legal/grievance',
      '/legal/product-safety',
      '/legal/business-disclosure',
      '/about',
      '/contact',
    ]) {
      expect(hrefs, href).toContain(href);
    }
    const labels = FALLBACK_FOOTER_LINKS.map((link) => link.label).join(' ');
    for (const forbidden of ['GSTIN', '8987023959', 'Plot No. 231', 'adinathsahu8987']) {
      expect(labels).not.toContain(forbidden);
    }
  });
});

describe('content.manage permission', () => {
  // `seller` is deliberately absent: the role was retired with the marketplace
  // and is no longer part of UserRole.
  const roles: UserRole[] = ['super_admin', 'admin', 'staff', 'salesman', 'retailer'];

  it('is held by the Super Admin and by nobody else', () => {
    expect(can('super_admin', 'content.manage')).toBe(true);
    for (const role of roles.filter((entry) => entry !== 'super_admin')) {
      expect(can(role, 'content.manage'), role).toBe(false);
    }
  });

  it('is advertised to the Super Admin bootstrap used by the mobile app', () => {
    expect(permissionsForRole('super_admin')).toContain('content.manage');
  });
});
