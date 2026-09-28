/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { PromoBanner } from '@/components/retailer/promo-banner';
import { PromoCarousel } from '@/components/retailer/promo-carousel';
import {
  BANNER_STANDARD,
  bannerScheduleInstants,
  isBannerVisible,
  resolveBannerTarget,
} from '@/lib/retailer/banner-target';

/**
 * BANNERS — scheduling, targeting and the 1080 × 360 (3:1) artwork rule.
 *
 * The banner feature already existed (table, admin CRUD, storage bucket); these
 * tests pin the behaviour the storefront promises:
 *
 *   - only ACTIVE banners in their window reach the carousel,
 *   - an end date covers the WHOLE day in India time (end-of-day IST), so a
 *     banner never disappears on its own last day,
 *   - the artwork renders in a fixed 3:1 box with object-cover (crop, never
 *     stretch),
 *   - no banners ⇒ NOTHING renders (no reserved empty box),
 *   - the carousel has one dot per banner and the dots switch slides,
 *   - a banner with no safe target shows no CTA.
 */

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) =>
    React.createElement('a', { href, ...props }, children),
}));

vi.mock('next/image', () => ({
  default: ({ src, alt, className, fill }: { src: string; alt: string; className?: string; fill?: boolean }) =>
    React.createElement('img', { src, alt, className, 'data-fill': fill ? 'true' : undefined }),
}));

afterEach(cleanup);

beforeEach(() => {
  // jsdom has no matchMedia; the carousel only needs `matches` + listeners.
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
});

const AREA = 'area-1';
const JAN_1_IST_MIDNIGHT = Date.parse('2026-01-01T00:00:00+05:30'); // 2025-12-31T18:30Z

const banner = {
  id: 'banner-1',
  title: 'Diwali offer',
  subtitle: 'Merchant subtitle',
  image_url: '/banner.png',
  link_url: '/retailer/catalog',
  cta_label: 'Shop the offer',
  is_active: true,
  area_id: null as string | null,
  starts_at: null as string | null,
  ends_at: null as string | null,
};

// ---------------------------------------------------------------------------
// Scheduling (India time, inclusive end date)
// ---------------------------------------------------------------------------
describe('banner schedule', () => {
  it('starts a start date at 00:00 IST and makes an end date cover the whole IST day', () => {
    const schedule = bannerScheduleInstants('2026-01-01', '2026-01-10');
    expect(Date.parse(schedule.startsAt!)).toBe(JAN_1_IST_MIDNIGHT);
    expect(Date.parse(schedule.endsAt!)).toBe(Date.parse('2026-01-10T23:59:59.999+05:30'));
  });

  it('reads legacy date-only rows (midnight UTC) with the same inclusive meaning', () => {
    const schedule = bannerScheduleInstants('2026-01-01T00:00:00.000Z', '2026-01-10T00:00:00Z');
    expect(Date.parse(schedule.startsAt!)).toBe(JAN_1_IST_MIDNIGHT);
    expect(Date.parse(schedule.endsAt!)).toBe(Date.parse('2026-01-10T23:59:59.999+05:30'));
  });

  it('keeps a real timestamp untouched and drops an unusable one', () => {
    const schedule = bannerScheduleInstants('2026-01-01T09:30:00.000Z', 'later');
    expect(schedule.startsAt).toBe('2026-01-01T09:30:00.000Z');
    expect(schedule.endsAt).toBeNull();
  });
});

describe('banner visibility', () => {
  const now = Date.parse('2026-01-05T12:00:00+05:30');

  it('shows an active, unbounded banner', () => {
    expect(isBannerVisible(banner, AREA, now)).toBe(true);
  });

  it('hides an inactive, future, expired or unparseable banner', () => {
    expect(isBannerVisible({ ...banner, is_active: false }, AREA, now)).toBe(false);
    expect(isBannerVisible({ ...banner, starts_at: '2026-02-01T00:00:00+05:30' }, AREA, now)).toBe(false);
    expect(isBannerVisible({ ...banner, ends_at: '2026-01-01T00:00:00+05:30' }, AREA, now)).toBe(false);
    expect(isBannerVisible({ ...banner, ends_at: 'not-a-date' }, AREA, now)).toBe(false);
  });

  it('keeps a banner up through the END of its end date (IST)', () => {
    const lastDay = Date.parse('2026-01-10T23:30:00+05:30');
    const nextDay = Date.parse('2026-01-11T00:30:00+05:30');
    const scheduled = { ...banner, starts_at: '2026-01-01', ends_at: '2026-01-10' };
    expect(isBannerVisible(scheduled, AREA, lastDay)).toBe(true);
    expect(isBannerVisible(scheduled, AREA, nextDay)).toBe(false);
  });

  it('scopes by area but a banner with no area serves everyone', () => {
    expect(isBannerVisible({ ...banner, area_id: 'other-area' }, AREA, now)).toBe(false);
    expect(isBannerVisible({ ...banner, area_id: AREA }, AREA, now)).toBe(true);
    expect(isBannerVisible(banner, null, now)).toBe(true);
    expect(isBannerVisible({ ...banner, area_id: AREA }, null, now)).toBe(false);
  });
});

describe('banner target safety', () => {
  it('accepts an internal route and an external https link', () => {
    expect(resolveBannerTarget('/retailer/catalog?q=tea')).toEqual({
      href: '/retailer/catalog?q=tea',
      external: false,
    });
    expect(resolveBannerTarget('https://merchant.test/offer')).toMatchObject({ external: true });
  });

  it('refuses script, protocol-relative and unparseable targets', () => {
    expect(resolveBannerTarget('javascript:alert(1)')).toBeNull();
    expect(resolveBannerTarget('//evil.test')).toBeNull();
    expect(resolveBannerTarget('not a url')).toBeNull();
    expect(resolveBannerTarget('')).toBeNull();
    expect(resolveBannerTarget(null)).toBeNull();
  });

  it('states the artwork standard as 1080 × 360 (3:1)', () => {
    expect(BANNER_STANDARD.width).toBe(1080);
    expect(BANNER_STANDARD.height).toBe(360);
    expect(BANNER_STANDARD.aspectRatio).toBe('3 / 1');
    expect(BANNER_STANDARD.guidance).toContain('1080 × 360');
  });
});

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------
describe('banner artwork', () => {
  it('renders the image in a fixed 3:1 box with object-cover', () => {
    const { container } = render(<PromoBanner title="Diwali offer" imageUrl="/banner.png" linkUrl="/retailer/catalog" ctaLabel="Shop" />);
    const frame = container.querySelector('.aspect-\\[3\\/1\\]');
    expect(frame).toBeTruthy();
    const image = screen.getByRole('img', { name: 'Diwali offer' });
    expect(image.className).toContain('object-cover');
    expect(image.getAttribute('data-fill')).toBe('true');
  });

  it('shows the merchant CTA only when there is a safe target', () => {
    const unsafe = render(<PromoBanner title="No link" imageUrl="/banner.png" linkUrl={null} />);
    expect(screen.queryByRole('link')).toBeNull();
    unsafe.unmount();
    render(<PromoBanner title="Linked" imageUrl="/banner.png" linkUrl="/retailer/catalog" />);
    expect(screen.getByRole('link').getAttribute('href')).toBe('/retailer/catalog');
  });
});

describe('carousel', () => {
  const banners = [
    { id: 'a', title: 'First promotion', image_url: '/a.png', link_url: '/retailer/catalog', subtitle: null, cta_label: 'First CTA' },
    { id: 'b', title: 'Second promotion', image_url: '/b.png', link_url: '/retailer/catalog?sort=newest', subtitle: null, cta_label: 'Second CTA' },
  ];

  it('renders NOTHING when no banner is active — never a giant empty box', () => {
    const { container } = render(<PromoCarousel banners={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it('shows one dot per banner and the dots switch the visible slide', () => {
    render(<PromoCarousel banners={banners} />);
    expect(screen.getAllByRole('button', { name: /show promotion/i })).toHaveLength(2);
    expect(screen.getByRole('link', { name: 'First CTA' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Show promotion 2' }));
    expect(screen.getByRole('link', { name: 'Second CTA' })).toBeTruthy();
  });
});
