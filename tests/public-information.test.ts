import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(__dirname, '..');
const read = (path: string) => readFileSync(join(root, path), 'utf8');
const publicPages = ['about', 'contact', 'legal/terms', 'legal/privacy', 'legal/shipping', 'legal/returns', 'legal/grievance'];

describe('public business information and review gates', () => {
  it.each(publicPages)('%s has a buildable public route and shared review notice', (route) => {
    const path = `app/${route}/page.tsx`;
    expect(existsSync(join(root, path))).toBe(true);
    const page = read(path);
    expect(page).toContain('PublicInfoShell');
    expect(page).toContain('export const metadata');
  });

  it('labels missing business/legal details rather than inventing them', () => {
    const shell = read('components/legal/public-info-shell.tsx');
    const contact = read('app/contact/page.tsx');
    expect(shell).toContain('Publication review required.');
    expect(shell).toContain('tax/invoice responsibility');
    expect(contact).toContain('have not been provided');
    expect(contact).toContain('/retailer/help');
    expect(contact).toContain('/forgot-password');
  });

  it('disclaims blanket Gaya PIN coverage, tracking and unapproved returns', () => {
    expect(read('app/legal/shipping/page.tsx')).toContain('not all Gaya PINs are serviceable');
    expect(read('app/legal/shipping/page.tsx')).toContain('not real-time location tracking');
    expect(read('app/legal/returns/page.tsx')).toContain('No unverified blanket return period');
  });

  it('exposes terms, privacy and contact in anonymous and signed-in navigation', () => {
    for (const path of ['components/auth/auth-frame.tsx', 'components/layout/retailer-shell.tsx', 'components/layout/admin-shell.tsx']) {
      const nav = read(path);
      for (const href of ['/legal/terms', '/legal/privacy', '/contact']) {
        expect(nav).toContain(`href="${href}"`);
      }
    }
    const seller = read('app/seller/layout.tsx');
    expect(seller).toContain('href="/legal/terms"');
    expect(seller).toContain('href="/contact"');
    const middleware = read('middleware.ts');
    expect(middleware).not.toMatch(/PROTECTED_PREFIXES = \[[^\]]*['"]\/legal['"]/);
  });

  it('adds an accessible review-gated Grievance Redressal route to the shared authentication frame', () => {
    const authFrame = read('components/auth/auth-frame.tsx');
    const grievance = read('app/legal/grievance/page.tsx');
    expect(authFrame).toContain('aria-label="Public information"');
    expect(authFrame).toContain('href="/legal/grievance"');
    expect(authFrame).toContain('>Grievance Redressal</Link>');
    expect(grievance).toContain('review-stage grievance information page');
    expect(grievance).toContain('not represented as a statutory or operational SLA');
    expect(grievance).not.toContain('e.g. grievance@');
    expect(grievance).not.toContain('Gaya District, Bihar');
  });

  it('keeps the professional-review legal pack unpublished and versioned', () => {
    const index = read('docs/legal-review/README.md');
    expect(index).toContain('unpublished');
    for (const document of [
      'TERMS_AND_CONDITIONS.md',
      'PRIVACY_POLICY.md',
      'SHIPPING_AND_DELIVERY_POLICY.md',
      'CANCELLATION_RETURNS_REFUNDS_POLICY.md',
      'GRIEVANCE_REDRESSAL_POLICY.md',
      'MARKETPLACE_SELLER_AGREEMENT.md',
      'SELLER_COMPLIANCE_DECLARATION.md',
      'PRODUCT_AUTHENTICITY_ANTI_COUNTERFEIT_POLICY.md',
    ]) {
      const content = read(`docs/legal-review/${document}`);
      expect(content).toContain('0.1-review-draft');
      expect(content).toMatch(/not .*publication|unpublished/i);
    }
  });
});
