/**
 * Premium visual system + catalogue acceptance contract.
 *
 * These are executed checks on the real modules (Tailwind theme object, manifest
 * function, catalogHref) and source checks on the screens that must show both
 * Categories and Brands on the catalogue.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import tailwindConfig from '@/tailwind.config';
import manifest from '@/app/manifest';
import { catalogHref } from '@/lib/retailer/catalog-params';

const root = process.cwd();
const read = (rel: string) => readFileSync(join(root, rel), 'utf8');
const colors = (tailwindConfig.theme?.extend?.colors ?? {}) as Record<string, Record<string, string>>;

describe('premium palette — shared pastel Maharani system', () => {
  const registry = JSON.parse(read('design/tokens.json')) as {
    families: Record<string, { tokens: Record<string, string> }>;
    semantic: Record<string, { ref: string }>;
  };

  it('documents 117 palette values in 12 families and 39 semantic aliases', () => {
    const paletteCount = Object.values(registry.families).reduce(
      (count, family) => count + Object.keys(family.tokens).length,
      0,
    );
    expect(Object.keys(registry.families)).toHaveLength(12);
    expect(paletteCount).toBe(117);
    expect(Object.keys(registry.semantic)).toHaveLength(39);
    expect(read('docs/design-system.md')).toContain('117 documented palette tokens across 12 coherent families');
  });

  it('resolves primary and action to the same documented violet token', () => {
    expect(registry.semantic['action.primary']?.ref).toBe('violet.600');
    expect(colors.primary?.[600]).toContain('--palette-violet-600-rgb');
    expect(colors.action?.[600]).toBe(colors.primary?.[600]);
  });

  it('exposes the coordinated mint, lavender, peach, sky and ivory scales', () => {
    for (const tone of ['mint', 'lavender', 'peach', 'sky']) {
      expect(colors[tone]?.[100]).toContain('--palette-');
    }
    expect(colors.blush?.[100]).toContain('--palette-pastel-pink-100-rgb');
    expect(colors.ivory?.DEFAULT).toBe('var(--palette-ivory-100)');
    expect(colors.slate?.[50]).toContain('--palette-slate-50-rgb');
    expect(colors.ink?.[900]).toContain('--palette-navy-900-rgb');
  });

  it('uses the shared violet and ivory on install, offline, manifest and app chrome', () => {
    const violet = registry.families.violet!.tokens['600']!;
    const install = read('components/pwa/InstallPrompt.tsx');
    const offline = read('public/offline.html');
    expect(install).toContain('var(--color-action-primary)');
    expect(install).toContain('var(--color-surface-card)');
    expect(offline).toContain(`--violet: ${violet};`);
    expect(manifest().theme_color).toBe(violet);
    expect(manifest().background_color).toBe(registry.families.ivory!.tokens['100']!);
    expect(read('app/layout.tsx')).toContain(`themeColor: '${violet}'`);
  });

  it('removes prior red/wine brand values from the app chrome', () => {
    for (const file of [
      'app/layout.tsx',
      'app/manifest.ts',
      'components/pwa/InstallPrompt.tsx',
      'public/offline.html',
      'lib/retailer/invoice-html.ts',
    ]) {
      const source = read(file).toLowerCase();
      expect(source).not.toContain('#c8102e');
      expect(source).not.toContain('#8f1d40');
      expect(source).not.toContain('#e11d48');
    }
    expect(read('components/layout/retailer-shell.tsx')).not.toContain('bg-[#fafafa]');
  });
});

describe('catalogue — categories and brands are both visible and combine', () => {
  const catalog = read('app/retailer/catalog/page.tsx');

  it('shows a "Shop by category" section and a "Shop by brand" section', () => {
    expect(catalog).toContain('Shop by category');
    expect(catalog).toContain('aria-label="Shop by brand"');
    expect(catalog).toContain('Shop by brand');
  });

  it('brand chips use the same brand filter parameter as the filter panel', () => {
    expect(catalog).toMatch(/catalogHref\(\{ \.\.\.filterValues, brand: active \? undefined : brand\.id \}\)/);
  });

  it('the category and brand filters are kept together in the same link', () => {
    const href = catalogHref({ category: 'cat-1', brand: 'brand-9' });
    const params = new URLSearchParams(href.split('?')[1]);
    expect(params.get('category')).toBe('cat-1');
    expect(params.get('brand')).toBe('brand-9');
  });

  it('a brand chip keeps an existing category selected', () => {
    const href = catalogHref({ category: 'cat-1', brand: 'brand-9', q: 'rice' });
    expect(href).toContain('category=cat-1');
    expect(href).toContain('brand=brand-9');
    expect(href).toContain('q=rice');
  });

  it('clearing the brand removes only the brand', () => {
    const href = catalogHref({ category: 'cat-1', brand: undefined });
    expect(href).toContain('category=cat-1');
    expect(href).not.toContain('brand=');
  });
});

describe('home — premium banner and service-area selector', () => {
  const home = read('components/retailer/home-content.tsx');
  it('renders an ivory/lavender storefront hero with catalogue and reorder entry points', () => {
    expect(home).toContain('bg-lavender-50');
    expect(home).not.toContain('bg-blush-50');
    expect(home).toContain('Explore catalogue');
    expect(home).toContain('Buy again');
    expect(read('app/globals.css')).not.toContain('.retailer-theme [class~=');
    expect(home).not.toContain('from-primary-50 via-white');
  });
  it('keeps the category shortcuts and brand discovery sections', () => {
    expect(home).toContain('aria-label="Shop by category"');
    expect(home).toContain('aria-label="Shop by brand"');
  });
});
