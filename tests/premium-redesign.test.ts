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

describe('premium palette — blush / ivory / wine / gold', () => {
  it('primary and action share the wine brand core (#8f1d40)', () => {
    expect(colors.primary?.[600]).toBe('#8f1d40');
    expect(colors.action?.[600]).toBe('#8f1d40');
  });

  it('the former marketplace blue is no longer the action colour', () => {
    expect(colors.action?.[600]).not.toBe('#1e5fd8');
    expect(colors.action?.[500]).not.toBe('#2874f0');
  });

  it('defines gold, blush and ivory accents', () => {
    expect(colors.gold?.[700]).toBeDefined();
    expect(colors.blush?.[100]).toBeDefined();
    expect(colors.ivory?.DEFAULT).toBeDefined();
  });

  it('warm slate replaces the cool grey default, with dark body text', () => {
    expect(colors.slate?.[50]).toBe('#fcf9f8');
    expect(colors.slate?.[900]).toBe('#231b1e');
  });

  it('manifest theme colour matches the primary brand core', () => {
    expect(manifest().theme_color).toBe(colors.primary?.[600]);
  });

  it('the install/offline surfaces use the same brand colour', () => {
    expect(read('components/pwa/InstallPrompt.tsx')).toContain("'#8f1d40'");
    expect(read('public/offline.html')).toContain('#8f1d40');
    expect(read('app/layout.tsx')).toContain("themeColor: '#8f1d40'");
  });

  it('no screen still uses the old red or blue hex values', () => {
    for (const file of ['app/layout.tsx', 'app/manifest.ts', 'components/pwa/InstallPrompt.tsx', 'public/offline.html']) {
      expect(read(file)).not.toContain('#c8102e');
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
  it('renders the welcome banner on a solid wine surface (no template gradient)', () => {
    expect(home).toContain('bg-primary-700');
    expect(home).not.toContain('from-primary-50 via-white');
  });
  it('keeps the category shortcuts and brand discovery sections', () => {
    expect(home).toContain('aria-label="Shop by category"');
    expect(home).toContain('aria-label="Shop by brand"');
  });
});
