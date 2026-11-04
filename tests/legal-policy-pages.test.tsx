import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import Terms from '@/app/legal/terms/page';
import Privacy from '@/app/legal/privacy/page';
import Shipping from '@/app/legal/shipping/page';
import Returns from '@/app/legal/returns/page';
import Grievance from '@/app/legal/grievance/page';
import ProductSafety from '@/app/legal/product-safety/page';
import BusinessDisclosure from '@/app/legal/business-disclosure/page';
import { PolicyLinks } from '@/components/legal/policy-links';

vi.mock('@/lib/admin/business-settings/server', () => ({
  getAuthoritativeContactGrievance: vi.fn().mockResolvedValue({ isConfigured: false }),
}));
import { getAuthoritativeContactGrievance } from '@/lib/admin/business-settings/server';

const pages = [Terms, Privacy, Shipping, Returns, Grievance, ProductSafety, BusinessDisclosure];
const paths = ['/legal/terms', '/legal/privacy', '/legal/shipping', '/legal/returns', '/legal/grievance', '/legal/product-safety', '/legal/business-disclosure'];

describe('local legal policies', () => {
  it.each(pages)('renders a dated policy with an accessible full policy navigation', async (Page) => {
    const html = renderToStaticMarkup(await Page());
    expect(html).toContain('04 November 2026');
    expect(html).toContain('Publication review required.');
    expect(html).toContain('aria-label="Policy links"');
    expect(html).toContain('flex-wrap');
    expect(html).toContain('md:grid-cols-');
    expect(html).toContain('min-h-11');
    for (const href of paths) expect(html).toContain(`href="${href}"`);
  });

  it('renders the owner-provided grievance contact as working tel and email links', async () => {
    const html = renderToStaticMarkup(await Grievance());
    expect(html).toContain('AJAY KUMAR');
    expect(html).toContain('AJAY GENERAL');
    expect(html).toContain('Plot No. 231');
    expect(html).toContain('804403');
    expect(html).toContain('href="tel:8987023959"');
    expect(html).toContain('href="mailto:adinathsahu8987@gmail.com"');
    expect(html).toContain('48 hours');
    expect(html).toContain('within one month');
  });

  it('retains the configured grievance settings as an additional contact when present', async () => {
    vi.mocked(getAuthoritativeContactGrievance).mockResolvedValueOnce({
      isConfigured: true, grievanceOfficerName: 'Configured Officer', grievanceOfficerDesignation: 'Officer',
      grievanceEmail: 'officer@maharani.example', grievancePhone: '9876543210', grievanceAddress: 'Configured address',
      officialPhone: '', supportEmail: '', acknowledgementHours: 48, resolutionDays: 30,
    });
    const html = renderToStaticMarkup(await Grievance());
    expect(html).toContain('AJAY KUMAR');
    expect(html).toContain('Configured Officer');
    expect(html).toContain('reconcile and verify before publication');
  });

  it('renders the same seven policy links for staff and salesman footers', () => {
    const html = renderToStaticMarkup(<PolicyLinks />);
    for (const href of paths) expect(html).toContain(`href="${href}"`);
  });
});
