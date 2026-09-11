/**
 * Static mobile-safety audit (executed via `vitest`).
 *
 * The app must be mobile-first and overflow-safe at 320–430px with no
 * page-level horizontal scrolling and no zoom. This sandbox has no browser
 * available (Playwright's CDN and distro packages are blocked), so these
 * guards verify the SOURCE-level invariants that make the layout safe, in
 * the same spirit as the existing retailer-ui-redesign source scans:
 *
 *  1. The root viewport locks zoom and enables viewport-fit (safe areas).
 *  2. Global CSS clips page-level horizontal overflow and kills double-tap.
 *  3. Inputs are 16px on phones (no WebView focus-zoom).
 *  4. New premium-upgrade components never hard-code widths beyond the
 *     smallest target viewport (320px).
 *  5. Sheets/dialogs and the compare table scroll INSIDE their containers.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '..');
const read = (relative: string) => readFileSync(join(ROOT, relative), 'utf8');

const NEW_COMPONENTS = [
  'components/retailer/address-form.tsx',
  'components/retailer/address-edit-toggle.tsx',
  'components/retailer/checkout-address-context.tsx',
  'components/retailer/checkout-address-selector.tsx',
  'components/retailer/cart-save-controls.tsx',
  'components/retailer/saved-cart-list.tsx',
  'components/retailer/profile-edit-forms.tsx',
  'components/retailer/security-forms.tsx',
  'components/retailer/notification-prefs-form.tsx',
  'components/retailer/product-feedback.tsx',
  'components/retailer/bulk-order-panel.tsx',
  'components/retailer/compare-grid.tsx',
];

const NEW_PAGES = [
  'app/retailer/account/edit/page.tsx',
  'app/retailer/account/security/page.tsx',
  'app/retailer/account/addresses/page.tsx',
  'app/retailer/account/notification-preferences/page.tsx',
  'app/retailer/cart/saved/page.tsx',
  'app/retailer/reports/page.tsx',
];

/** Arbitrary Tailwind width values in px/rem that exceed a 320px phone. */
const WIDTH_TOKEN = /(?:w|min-w|max-w)-\[([0-9.]+)(px|rem)\]/g;

function violationsFor(source: string): string[] {
  const violations: string[] = [];
  for (const match of source.matchAll(WIDTH_TOKEN)) {
    const value = Number(match[1]);
    const unit = match[2];
    const px = unit === 'rem' ? value * 16 : value;
    // Anything wider than a 320px viewport (minus page padding) would push
    // the page sideways unless it sits in a contained scroll area.
    if (px > 300) violations.push(match[0]);
  }
  return violations;
}

describe('mobile safety of the premium upgrade surface', () => {
  it('root viewport locks zoom and exposes safe-area insets', () => {
    const layout = read('app/layout.tsx');
    expect(layout).toContain('maximumScale: 1');
    expect(layout).toContain('userScalable: false');
    expect(layout).toContain("viewportFit: 'cover'");
    expect(layout).toContain('initialScale: 1');
  });

  it('global CSS clips page-level horizontal overflow and double-tap zoom', () => {
    const css = read('app/globals.css');
    expect(css).toContain('touch-action: manipulation');
    expect(css).toMatch(/overflow-x:\s*(hidden|clip)/);
    expect(css).toMatch(/font-size: 16px/); // no WebView focus-zoom on phones
    expect(css).toContain('safe-area-inset'); // components pad with insets
  });

  it('every new component/page stays inside the 320px viewport without overflow widths', () => {
    // compare-grid's min-w-[480px] is the comparison TABLE inside the sheet,
    // which scrolls within its own overflow-auto container (asserted below).
    const CONTAINED_SCROLL_ALLOWLIST = new Map([['components/retailer/compare-grid.tsx', new Set(['min-w-[480px]'])]]);
    for (const file of [...NEW_COMPONENTS, ...NEW_PAGES]) {
      const allow = CONTAINED_SCROLL_ALLOWLIST.get(file) ?? new Set<string>();
      const violations = violationsFor(read(file)).filter((token) => !allow.has(token));
      expect(violations, `${file} hard-codes oversized widths: ${violations.join(', ')}`).toEqual([]);
    }
  });

  it('dialogs and the compare table never exceed the viewport; they scroll within', () => {
    const feedback = read('components/retailer/product-feedback.tsx');
    expect(feedback).toMatch(/max-h-\[85dvh\]/);
    expect(feedback).toContain('overflow-y-auto');
    expect(feedback).toContain('w-full max-w-md');

    const compare = read('components/retailer/compare-grid.tsx');
    expect(compare).toMatch(/max-h-\[88dvh\]/);
    expect(compare).toContain('overflow-auto');
    // The comparison table scrolls INSIDE the sheet — the page never does.
    expect(compare).toContain('min-w-[480px]');

    const bulk = read('components/retailer/bulk-order-panel.tsx');
    expect(bulk).not.toMatch(/overflow-x-auto/);
  });

  it('the compare tray clears the bottom navigation with safe-area padding', () => {
    const compare = read('components/retailer/compare-grid.tsx');
    expect(compare).toContain('bottom-[calc(4.75rem+env(safe-area-inset-bottom))]');
  });

  it('Android/Capacitor config still targets the app shell correctly', () => {
    const capacitor = read('capacitor.config.ts');
    expect(capacitor).toContain('appId');
    expect(capacitor).toContain('android');
  });
});
