import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('next/navigation', () => ({ notFound: () => { throw new Error('NOT_FOUND'); } }));

import { ManagedPageView, UnavailablePage, informationNav } from '@/components/legal/managed-page';
import { renderRichText } from '@/lib/site-content/render';
import type { PublishedPageRecord, PublishedPageSummary } from '@/lib/site-content/types';

const record: PublishedPageRecord = {
  state: 'published',
  slug: 'returns',
  kind: 'legal',
  audience: 'buyers',
  nav_label: 'Returns',
  short_label: 'Returns',
  show_contact_details: true,
  related_slugs: ['terms'],
  version: '1.2',
  effective_date: '2026-11-04',
  published_at: '2026-11-14T00:00:00Z',
  page: {
    title: 'Cancellation, Return and Refund Policy',
    nav_label: 'Returns',
    short_label: 'Returns',
    eyebrow: 'Legal policies',
    intro: 'When an order can be cancelled and how refunds work.',
    meta_description: 'Returns summary',
    hero_image_url: null,
    version: '1.2',
    effective_date: '2026-11-04',
    sections: [
      {
        heading: 'Order cancellation',
        body: ['Contact us to cancel. See the [Terms](/legal/terms) for details.'],
        bullets: ['Before dispatch', 'After dispatch'],
        tone: 'standard',
        image_url: null,
        link_label: 'Contact support',
        link_href: '/contact',
        sort_order: 10,
      },
      {
        heading: 'Refund timing',
        body: ['Refunds follow the original payment method.'],
        bullets: [],
        tone: 'highlight',
        image_url: null,
        link_label: null,
        link_href: null,
        sort_order: 20,
      },
    ],
  },
};

const summary: PublishedPageSummary = {
  slug: 'returns',
  kind: 'legal',
  audience: 'buyers',
  nav_label: 'Returns',
  short_label: 'Returns',
  title: 'Cancellation, Return and Refund Policy',
  summary: 'Returns summary',
  version: '1.2',
  effective_date: '2026-11-04',
  sort_order: 10,
  show_in_footer: true,
  show_in_index: true,
};

describe('managed page rendering', () => {
  it('renders the published wording, version and effective date in order', () => {
    const html = renderToStaticMarkup(<ManagedPageView page={record} allPages={[summary]} />);
    expect(html).toContain('Cancellation, Return and Refund Policy');
    expect(html).toContain('When an order can be cancelled and how refunds work.');
    expect(html).toContain('Version');
    expect(html).toContain('1.2');
    expect(html).toContain('04 November 2026');
    expect(html.indexOf('Order cancellation')).toBeLessThan(html.indexOf('Refund timing'));
    expect(html).toContain('Before dispatch');
    expect(html).toContain('href="/contact"');
    expect(html).toContain('Contact support');
  });

  it('contains no operator wording of any kind', () => {
    const html = renderToStaticMarkup(<ManagedPageView page={record} allPages={[summary]} />);
    for (const forbidden of [
      'Publication review required',
      'Owner review',
      'owner review',
      'internal',
      'Draft',
      'draft',
      'review pending',
      'awaiting the owner',
      'Super Admin',
    ]) {
      expect(html, forbidden).not.toContain(forbidden);
    }
  });

  it('renders inline links safely and never as a script URL', () => {
    const nodes = renderRichText('Read [the terms](/legal/terms), [mail](mailto:help@example.test), or [bad](javascript:alert(1)).');
    const html = renderToStaticMarkup(<p>{nodes}</p>);
    expect(html).toContain('href="/legal/terms"');
    expect(html).toContain('href="mailto:help@example.test"');
    expect(html).not.toContain('javascript:');
    expect(html).toContain('bad');
  });

  it('shows a clean, customer-friendly message for an unpublished page', () => {
    const html = renderToStaticMarkup(<UnavailablePage navLabel="Returns" />);
    expect(html).toContain('This page is not available right now.');
    expect(html).not.toMatch(/draft|unpublish|review|admin/i);
    expect(html).toContain('href="/legal"');
    expect(html).toContain('href="/contact"');
  });

  it('builds the information navigation from the published pages only', () => {
    const other: PublishedPageSummary = { ...summary, slug: 'privacy', nav_label: 'Privacy', short_label: 'Privacy', show_in_footer: false };
    const nav = informationNav([summary, other]);
    expect(nav).toEqual([{ href: '/legal/returns', label: 'Returns' }]);
    expect(informationNav([])).toBeUndefined();
  });
});
