import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(__dirname, '..');
const read = (path: string) => readFileSync(join(root, path), 'utf8');
const policyRoutes = ['terms', 'privacy', 'shipping', 'returns', 'grievance', 'product-safety', 'business-disclosure'];
const policyPaths = policyRoutes.map((route) => `/legal/${route}`);

describe('public information and local policy review gates', () => {
  it.each(['about', 'contact', ...policyRoutes.map((route) => `legal/${route}`)])('%s has a public route with the shared review shell', (route) => {
    const path = `app/${route}/page.tsx`;
    expect(existsSync(join(root, path))).toBe(true);
    const page = read(path);
    expect(page).toContain('PublicInfoShell');
    expect(page).toContain('export const metadata');
  });

  it('retains the review gate and displays only the owner-provided contact information', () => {
    const shell = read('components/legal/public-info-shell.tsx');
    const contact = read('components/legal/business-contact.tsx');
    expect(shell).toContain('Publication review required.');
    expect(shell).toContain('Indian legal/tax review');
    for (const value of ['AJAY KUMAR', 'AJAY GENERAL', 'MAHARANI TRADERS', 'Plot No. 231', '804403', '8987023959', 'adinathsahu8987@gmail.com']) {
      expect(contact).toContain(value);
    }
    expect(contact).toContain('tel:8987023959');
    expect(contact).toContain('mailto:adinathsahu8987@gmail.com');
    expect(read('app/contact/page.tsx')).toContain('/retailer/help');
    expect(read('app/contact/page.tsx')).toContain('/forgot-password');
  });

  it('shows the effective date on every policy and preserves relevant delivery and refund limits', () => {
    for (const route of policyRoutes) expect(read(`app/legal/${route}/page.tsx`)).toContain('04 November 2026');
    const shipping = read('app/legal/shipping/page.tsx');
    expect(shipping).toMatch(/not all Gaya PINs are serviceable/i);
    expect(shipping).toContain('not real-time location tracking');
    const returns = read('app/legal/returns/page.tsx');
    expect(returns).toContain('No unverified blanket return period');
    expect(returns).toContain('order-specific deadline');
    expect(returns).toContain('does not remove statutory rights or remedies');
  });

  it('discloses own-stock, food exclusion, seller policy boundary and actual checkout Coins behavior', () => {
    const terms = read('app/legal/terms/page.tsx');
    expect(terms).toContain('Food products are excluded');
    expect(terms).toContain('application includes marketplace and seller features');
    expect(terms).toContain('do not provide a complete set of terms for third-party seller transactions');
    expect(terms).toContain('ongoing operation requires separately reviewed customer and seller terms');
    expect(terms).toContain('Coins balance automatically');
    expect(terms).toContain('Cash on Delivery (COD)');
    expect(read('app/legal/business-disclosure/page.tsx')).toContain('not a separate incorporated company');
    expect(read('app/legal/product-safety/page.tsx')).toContain('food is excluded');
    const privacy = read('app/legal/privacy/page.tsx');
    expect(privacy).toContain('third-party seller fulfilment');
    expect(privacy).toContain('recipient address and phone');
    expect(privacy).toContain('data flows and disclosures require verification');
  });

  it('exposes all seven policies in every existing public, retailer, admin and seller footer/navigation', () => {
    for (const path of ['components/auth/auth-frame.tsx', 'components/layout/retailer-shell.tsx', 'components/layout/admin-shell.tsx', 'app/seller/layout.tsx', 'components/legal/public-info-shell.tsx', 'components/legal/policy-links.tsx']) {
      const nav = read(path);
      for (const href of policyPaths) expect(nav, `${path} missing ${href}`).toContain(href);
    }
    for (const path of ['components/layout/staff-shell.tsx', 'components/layout/salesman-shell.tsx']) expect(read(path)).toContain('<PolicyLinks />');
    expect(read('components/auth/auth-frame.tsx')).toContain('aria-label="Public information"');
    const middleware = read('middleware.ts');
    expect(middleware).not.toMatch(/PROTECTED_PREFIXES = \[[^\]]*['"]\/legal['"]/);
  });

  it('identifies the proprietor as grievance officer and retains the owner-proposed timelines', () => {
    const grievance = read('app/legal/grievance/page.tsx');
    expect(grievance).toContain('BusinessContact officer');
    expect(grievance).toContain('48 hours');
    expect(grievance).toContain('within one month');
    expect(grievance).toContain('require operational and legal verification');
    expect(grievance).toContain('statutory rights and timelines are not affected');
  });

  it('keeps the professional-review legal pack unpublished and versioned', () => {
    const index = read('docs/legal-review/README.md');
    expect(index).toMatch(/unpublished/i);
    for (const document of [
      'TERMS_AND_CONDITIONS.md', 'PRIVACY_POLICY.md', 'SHIPPING_AND_DELIVERY_POLICY.md',
      'CANCELLATION_RETURNS_REFUNDS_POLICY.md', 'GRIEVANCE_REDRESSAL_POLICY.md',
      'MARKETPLACE_SELLER_AGREEMENT.md', 'SELLER_COMPLIANCE_DECLARATION.md',
      'PRODUCT_AUTHENTICITY_ANTI_COUNTERFEIT_POLICY.md',
    ]) {
      const content = read(`docs/legal-review/${document}`);
      expect(content).toContain('0.1-review-draft');
      expect(content).toMatch(/not .*publication|unpublished/i);
    }
  });
});
