import { beforeEach, describe, expect, it, vi } from 'vitest';

const redirects = vi.hoisted(() => vi.fn());

vi.mock('next/navigation', () => ({
  permanentRedirect: redirects,
}));

import PrivacyRedirect from '@/app/privacy/page';
import ReturnsRedirect from '@/app/returns/page';
import ShippingRedirect from '@/app/shipping/page';
import TermsRedirect from '@/app/terms/page';

describe('legacy legal canonical redirects', () => {
  beforeEach(() => redirects.mockReset());

  it.each([
    ['privacy', PrivacyRedirect, '/legal/privacy'],
    ['terms', TermsRedirect, '/legal/terms'],
    ['shipping', ShippingRedirect, '/legal/shipping'],
    ['returns', ReturnsRedirect, '/legal/returns'],
  ] as const)('permanently redirects /%s to its canonical policy URL and retains query parameters', (_legacy, Page, canonical) => {
    Page({ searchParams: { source: 'notice', campaign: ['october', 'launch'] } });

    expect(redirects).toHaveBeenCalledTimes(1);
    expect(redirects).toHaveBeenCalledWith(`${canonical}?source=notice&campaign=october&campaign=launch`);
  });

  it('does not add a trailing question mark when no query string was supplied', () => {
    PrivacyRedirect({});
    expect(redirects).toHaveBeenCalledWith('/legal/privacy');
  });
});
