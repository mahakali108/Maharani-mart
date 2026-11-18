import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const root = join(__dirname, '..');
const read = (path: string) => readFileSync(join(root, path), 'utf8');
const policyRoutes = ['terms', 'privacy', 'shipping', 'returns', 'grievance', 'product-safety', 'business-disclosure'];
const policyPaths = policyRoutes.map((route) => `/legal/${route}`);

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(join(root, dir))) {
    const relative = `${dir}/${entry}`;
    if (statSync(join(root, relative)).isDirectory()) walk(relative, out);
    else if (/\.(ts|tsx)$/.test(entry)) out.push(relative);
  }
  return out;
}

describe('public information pages come from managed content', () => {
  it('serves About, Contact and every policy from the content module', () => {
    expect(read('app/about/page.tsx')).toContain('ManagedPublicPage slug="about"');
    expect(read('app/contact/page.tsx')).toContain('ManagedPublicPage slug="contact"');
    expect(read('app/legal/[slug]/page.tsx')).toContain('loadPublishedPage(slug)');
    expect(read('app/legal/page.tsx')).toContain('loadPublishedPages()');

    // The old per-page JSX policy routes are gone: one renderer, one source.
    for (const route of policyRoutes) {
      expect(existsSync(join(root, `app/legal/${route}/page.tsx`)), route).toBe(false);
    }
    // And the hardcoded contact component is gone with them.
    expect(existsSync(join(root, 'components/legal/business-contact.tsx'))).toBe(false);
  });

  it('keeps the public disclosure of which document is deliberately not published', () => {
    // The pre-rewrite /legal page told readers that the advertising/sponsored-
    // listing policy does not exist as a feature. Dropping that card would remove
    // a public disclosure, so the index must keep rendering NOT_APPLICABLE_DOCUMENTS.
    const index = read('app/legal/page.tsx');
    expect(index).toContain('NOT_APPLICABLE_DOCUMENTS');
    expect(index).toContain('Not published because the feature does not exist');
  });

  it('keeps a clean customer-facing answer for an unpublished page', () => {
    const page = read('app/legal/[slug]/page.tsx');
    expect(page).toContain('UnavailablePage');
    expect(read('components/legal/managed-page.tsx')).toContain('This page is not available right now.');
  });

  it('does not render any operator notice on a public page', () => {
    const publicSources = [
      ...walk('app/legal'),
      ...walk('components/legal'),
      'app/about/page.tsx',
      'app/contact/page.tsx',
    ];
    for (const file of publicSources) {
      const source = read(file);
      expect(source, file).not.toContain('Publication review required');
      expect(source, file).not.toContain('Indian legal/tax review');
      expect(source, file).not.toMatch(/awaiting the owner/i);
    }
  });

  it('builds every footer from managed published pages, not a code list', () => {
    // One mapping (lib/site-content/nav.ts) feeds the public shell, every role
    // shell and the sign-in frame. The home of the fallback list is asserted
    // separately below so an unpublished page leaves the footer without a
    // deploy and a renamed page cannot show two different labels.
    const nav = read('lib/site-content/nav.ts');
    expect(nav).toContain('loadPublishedPages()');
    expect(nav).toContain('export async function loadFooterLinks');
    expect(nav).toContain('footerLinksFromPages');
    for (const href of policyPaths) expect(nav, `fallback missing ${href}`).toContain(href);

    // Presentational only: the component cannot carry a page list of its own.
    const component = read('components/legal/policy-links.tsx');
    expect(component).toContain('links: FooterLink[]');
    for (const href of policyPaths) expect(component, `policy-links hardcodes ${href}`).not.toContain(href);

    // Layouts load the managed links server-side; shells only render them.
    // The seller portal layout is intentionally absent: that workspace was
    // removed with the marketplace, so only the live layouts are checked.
    for (const path of [
      'app/admin/layout.tsx',
      'app/retailer/layout.tsx',
      'app/staff/layout.tsx',
      'app/salesman/layout.tsx',
    ]) {
      expect(read(path), path).toContain('loadFooterLinks');
    }
    for (const path of [
      'components/layout/admin-shell.tsx',
      'components/layout/retailer-shell.tsx',
      'components/layout/staff-shell.tsx',
      'components/layout/salesman-shell.tsx',
    ]) {
      expect(read(path), path).toContain('footerLinks: FooterLink[]');
      expect(read(path), path).toContain('<PolicyLinks');
    }
    expect(read('components/auth/auth-frame.tsx')).toContain('loadFooterLinks');
    expect(read('components/auth/auth-frame.tsx')).toContain('aria-label="Public information"');
    expect(read('components/legal/public-info-shell.tsx')).toContain('FALLBACK_FOOTER_LINKS');

    // Nothing else in the app is allowed to re-type a policy address. Three
    // kinds of file legitimately name one, and no others may appear:
    //   - legacy top-level redirects (/terms -> /legal/terms) — they own the URL,
    //   - the legal document registry (lib/legal/documents.ts) — reference ids,
    //   - cache invalidation after a business-detail save.
    const allowedAddressOwners = new Set([
      'app/privacy/page.tsx',
      'app/returns/page.tsx',
      'app/shipping/page.tsx',
      'app/terms/page.tsx',
      'lib/legal/documents.ts',
      'lib/admin/business-settings/actions.ts',
    ]);
    const offenders = [...walk('app'), ...walk('components'), ...walk('lib')].filter((file) => {
      if (file === 'lib/site-content/nav.ts') return false;
      if (allowedAddressOwners.has(file)) return false;
      const source = read(file);
      return policyPaths.some((href) => source.includes(`'${href}'`) || source.includes(`"${href}"`));
    });
    expect(offenders).toEqual([]);

    expect(read('middleware.ts')).not.toMatch(/PROTECTED_PREFIXES = \[[^\]]*['"]\/legal['"]/);
  });

  it('keeps business contact details in editable content, not in a component', () => {
    const seed = JSON.parse(read('content/site-pages.seed.json')) as { pages: Array<{ slug: string; sections: Array<{ body: string[] }> }> };
    const contact = JSON.stringify(seed.pages.find((page) => page.slug === 'contact'));
    for (const value of ['AJAY KUMAR', 'Plot No. 231', '8987023959', 'adinathsahu8987@gmail.com']) {
      expect(contact, value).toContain(value);
    }

    // Application code must not carry them: only the seed and documentation may.
    for (const file of [...walk('app'), ...walk('components'), ...walk('lib')]) {
      const source = read(file);
      expect(source, file).not.toContain('adinathsahu8987@gmail.com');
      expect(source, file).not.toContain('8987023959');
      expect(source, file).not.toContain('Plot No. 231');
    }
  });

  it('keeps the professional-review legal pack unpublished and versioned', () => {
    const index = read('docs/legal-review/README.md');
    expect(index).toMatch(/unpublished/i);
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
