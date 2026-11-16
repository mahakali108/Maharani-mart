import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Route coverage for the public content endpoints the Android app uses:
 * `GET /api/mobile/v1/pages` and `GET /api/mobile/v1/pages/{slug}`.
 *
 * WHAT THESE PROVE
 *  1. the endpoints are public (no bearer token) — the Terms and the grievance
 *     route must be readable before sign-in, exactly like the website;
 *  2. only PUBLISHED content crosses the boundary: a draft, an internal note or
 *     an owner decision supplied by the database is not in the response, even if
 *     it appeared in the row;
 *  3. an unpublished page is a 404 with a machine-readable reason, so the app can
 *     show the same clean message instead of an error dialog;
 *  4. a database failure is a retryable 503, never an empty "no policies" claim;
 *  5. an invalid slug is refused before any query runs.
 *
 * Scope: the Supabase client is mocked here. RLS itself is proved in
 * `tests/site-content-db.test.ts` against real PostgreSQL.
 */

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('@/lib/mobile/clients', () => ({
  createMobileAnonClient: () => ({ rpc: mocks.rpc }),
}));

import { GET as listPages } from '@/app/api/mobile/v1/pages/route';
import { GET as getPage } from '@/app/api/mobile/v1/pages/[slug]/route';
import { resetRateLimits } from '@/lib/mobile/rate-limit';

const request = (path = '/api/mobile/v1/pages') => new Request(`https://api.example${path}`, { headers: { 'x-forwarded-for': '203.0.113.9' } });

const publishedRecord = {
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
  published_at: '2026-11-14T00:00:00.000Z',
  page: {
    title: 'Cancellation, Return and Refund Policy',
    nav_label: 'Returns',
    short_label: 'Returns',
    eyebrow: 'Legal policies',
    intro: 'When an order can be cancelled.',
    meta_description: 'Returns summary',
    hero_image_url: null,
    version: '1.2',
    effective_date: '2026-11-04',
    sections: [
      {
        heading: 'Order cancellation',
        body: ['Contact us to cancel.'],
        bullets: ['Before dispatch'],
        tone: 'highlight',
        image_url: null,
        link_label: 'Contact',
        link_href: '/contact',
        sort_order: 10,
      },
    ],
  },
  // Deliberately present in the row: the endpoint must not forward any of it.
  internal_notes: 'Owner verification pending',
  owner_decisions: ['Return window not decided'],
  review_status: 'owner_review_pending',
};

beforeEach(() => {
  resetRateLimits();
  mocks.rpc.mockReset();
});

describe('GET /api/mobile/v1/pages', () => {
  it('returns published pages in a mobile shape, without internal fields', async () => {
    mocks.rpc.mockResolvedValue({
      data: [
        {
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
          internal_notes: 'must not leave the server',
        },
      ],
      error: null,
    });

    const response = await listPages(request());
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.pages).toHaveLength(1);
    expect(body.data.pages[0]).toEqual({
      slug: 'returns',
      kind: 'legal',
      audience: 'buyers',
      navLabel: 'Returns',
      shortLabel: 'Returns',
      title: 'Cancellation, Return and Refund Policy',
      summary: 'Returns summary',
      version: '1.2',
      effectiveDate: '2026-11-04',
    });
    expect(JSON.stringify(body)).not.toContain('internal_notes');
    expect(mocks.rpc).toHaveBeenCalledWith('published_pages');
  });

  it('answers a database failure as a retryable 503, not as an empty list', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'connection reset' } });
    const response = await listPages(request());
    expect(response.status).toBe(503);
    expect((await response.json()).error.code).toBe('database_unavailable');
  });

  it('does not accept a POST', async () => {
    const { POST } = await import('@/app/api/mobile/v1/pages/route');
    expect((await POST()).status).toBe(405);
  });
});

describe('GET /api/mobile/v1/pages/{slug}', () => {
  const call = (slug: string) => getPage(request(`/api/mobile/v1/pages/${slug}`), { params: Promise.resolve({ slug }) });

  it('returns one published page with ordered sections and camelCase fields', async () => {
    mocks.rpc.mockResolvedValue({ data: publishedRecord, error: null });
    const response = await call('returns');
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data).toMatchObject({
      slug: 'returns',
      kind: 'legal',
      version: '1.2',
      effectiveDate: '2026-11-04',
      title: 'Cancellation, Return and Refund Policy',
      intro: 'When an order can be cancelled.',
      showContactDetails: true,
      relatedSlugs: ['terms'],
    });
    expect(body.data.sections).toEqual([
      {
        heading: 'Order cancellation',
        paragraphs: ['Contact us to cancel.'],
        bullets: ['Before dispatch'],
        tone: 'highlight',
        imageUrl: null,
        linkLabel: 'Contact',
        linkHref: '/contact',
      },
    ]);
    expect(JSON.stringify(body)).not.toMatch(/internal_notes|owner_decisions|review_status|Owner verification/);
    expect(mocks.rpc).toHaveBeenCalledWith('published_page', { p_slug: 'returns' });
  });

  it('answers an unpublished page with 404 and a reason the app can act on', async () => {
    mocks.rpc.mockResolvedValue({
      data: { state: 'unpublished', slug: 'returns', nav_label: 'Returns', message: 'This page is not available right now.' },
      error: null,
    });
    const response = await call('returns');
    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body.error.code).toBe('not_found');
    expect(body.error.details).toEqual({ slug: 'returns', reason: 'unpublished' });
  });

  it('answers a page that does not exist with 404', async () => {
    mocks.rpc.mockResolvedValue({ data: { state: 'missing' }, error: null });
    const response = await call('not-a-page');
    expect(response.status).toBe(404);
    expect((await response.json()).error.code).toBe('not_found');
  });

  it('refuses a malformed slug before querying anything', async () => {
    const response = await call('../../etc/passwd');
    expect(response.status).toBe(404);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('answers a database failure as a retryable 503', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'timeout' } });
    const response = await call('terms');
    expect(response.status).toBe(503);
    expect((await response.json()).error.code).toBe('database_unavailable');
  });
});
