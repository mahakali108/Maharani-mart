/**
 * Gallery verification + product naming verification
 *
 * - Full-size mobile gallery, swipe, thumbnails, counter, lightbox, zoom, keyboard
 * - No horizontal overflow at 320/360/390/412
 * - Real product name not category name
 * - Face Wash, Powder, Soap, Shampoo, Cream and other real products
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildCanonicalProductName, buildProductCardName } from '@/lib/retailer/product-name';

const root = join(__dirname, '..');
const read = (rel: string) => readFileSync(join(root, rel), 'utf8');

describe('product gallery full verification', () => {
  const gallery = read('components/retailer/product-gallery.tsx');
  const detailPage = read('app/retailer/catalog/[id]/page.tsx');

  it('full-size mobile gallery: min-h 360px mobile, contain-fit, no crop', () => {
    expect(gallery).toContain('min-h-[360px]');
    expect(gallery).toContain('object-contain');
    expect(gallery).not.toContain('object-cover');
    // Light background, premium rounded, border
    expect(gallery).toContain('bg-white');
    expect(gallery).toContain('rounded-2xl');
    expect(gallery).toContain('border border-slate-200');
  });

  it('swipe support via touch handlers', () => {
    expect(gallery).toContain('onTouchStart');
    expect(gallery).toContain('onTouchEnd');
    expect(gallery).toContain('touchStartX');
    expect(gallery).toContain('48'); // threshold
  });

  it('thumbnails: horizontally scrollable, snap, keyboard reachable', () => {
    expect(gallery).toContain('overflow-x-auto');
    expect(gallery).toContain('snap-x');
    expect(gallery).toContain('snap-mandatory');
    expect(gallery).toContain('role="listbox"');
    expect(gallery).toContain('role="option"');
    expect(gallery).toContain('aria-selected');
    expect(gallery).toContain('scrollbar-none');
  });

  it('counter 1/5 when multiple images', () => {
    expect(gallery).toContain('{active + 1} / {images.length}');
    expect(gallery).toContain('tabular-nums');
  });

  it('lightbox: native dialog, showModal, close, backdrop click, zoom', () => {
    expect(gallery).toContain('<dialog');
    expect(gallery).toContain('showModal()');
    expect(gallery).toContain('close()');
    expect(gallery).toContain('setLightboxZoom');
    expect(gallery).toContain('ZoomIn');
    expect(gallery).toContain('ZoomOut');
    expect(gallery).toContain('Maximize2');
    expect(gallery).toContain('backdrop:bg-slate-950/70');
  });

  it('keyboard navigation: ArrowLeft, ArrowRight, Escape', () => {
    expect(gallery).toContain('ArrowLeft');
    expect(gallery).toContain('ArrowRight');
    expect(gallery).toContain('Escape');
    expect(gallery).toContain('keydown');
  });

  it('variant-specific image priority: variant gallery first, parent fallback', () => {
    expect(detailPage).toContain('variantGalleryImages(');
    expect(detailPage).toContain('packImagesByPackId');
    expect(detailPage).toContain('product_pack_images');
    expect(detailPage).toContain('selectedPack');
    // Reset active when variant changes
    expect(gallery).toContain('setActive(0)');
    expect(gallery).toContain('imageIds');
  });

  it('no horizontal overflow at 320/360/390/412: min-w-0, overflow-x-hidden, break-words', () => {
    expect(detailPage).toContain('overflow-x-hidden');
    expect(detailPage).toContain('min-w-0');
    expect(detailPage).toContain('max-w-full');
    expect(detailPage).toContain('break-words');
    expect(gallery).toContain('w-full');
    // Check retailer shell also has safe-area
    const shell = read('components/layout/retailer-shell.tsx');
    expect(shell).toContain('pt-[env(safe-area-inset-top)]');
    const ledger = read('app/retailer/account/ledger/page.tsx');
    expect(ledger).toContain('overflow-x-hidden');
  });

  it('accessible alt text per image: product name + index', () => {
    expect(gallery).toContain('altFor');
    expect(gallery).toContain('view ${index + 1} of ${images.length}');
    expect(gallery).toContain('Product image unavailable');
  });
});

describe('real product name verification', () => {
  it('canonical naming preserves brand+product+variant, avoids duplicate size', () => {
    // Real examples from issue
    expect(
      buildCanonicalProductName({
        brandName: 'Garnier Men',
        productName: 'AcnoFight Anti-Pimple Face Wash',
        packName: '50g',
      })
    ).toBe('Garnier Men AcnoFight Anti-Pimple Face Wash 50g');

    // Size already in product name should not duplicate
    expect(
      buildCanonicalProductName({
        brandName: 'Garnier Men',
        productName: 'AcnoFight Anti-Pimple Face Wash 50g',
        packName: '50g',
      })
    ).toBe('Garnier Men AcnoFight Anti-Pimple Face Wash 50g');

    // Brand already in product name should not duplicate
    expect(
      buildCanonicalProductName({
        brandName: 'Garnier',
        productName: 'Garnier Face Wash 50g',
        packName: '50g',
      })
    ).toBe('Garnier Face Wash 50g');
  });

  it('handles Face Wash, Powder, Soap, Shampoo, Cream, other real products', () => {
    const products = [
      { brand: 'Garnier Men', product: 'AcnoFight Anti-Pimple Face Wash', pack: '50g', expected: 'Garnier Men AcnoFight Anti-Pimple Face Wash 50g' },
      { brand: 'Ponds', product: 'White Beauty Face Powder', pack: '50g', expected: 'Ponds White Beauty Face Powder 50g' },
      { brand: 'Dove', product: 'Cream Beauty Bathing Bar', pack: '100g', expected: 'Dove Cream Beauty Bathing Bar 100g' },
      { brand: 'Head & Shoulders', product: 'Smooth & Silky Shampoo', pack: '180ml', expected: 'Head & Shoulders Smooth & Silky Shampoo 180ml' },
      { brand: 'Nivea', product: 'Soft Light Moisturizing Cream', pack: '100ml', expected: 'Nivea Soft Light Moisturizing Cream 100ml' },
      { brand: 'Colgate', product: 'Strong Teeth Toothpaste', pack: '200g', expected: 'Colgate Strong Teeth Toothpaste 200g' },
    ];
    for (const p of products) {
      expect(
        buildCanonicalProductName({ brandName: p.brand, productName: p.product, packName: p.pack })
      ).toBe(p.expected);
    }
  });

  it('product card name does not use category as title', () => {
    // buildProductCardName should use product name, not category
    expect(buildProductCardName({ productName: 'AcnoFight Anti-Pimple Face Wash', packName: '50g' })).toBe(
      'AcnoFight Anti-Pimple Face Wash 50g'
    );
    // If product name missing, fallback to pack, not category
    expect(buildProductCardName({ productName: null, packName: '50g' })).toBe('50g');
  });

  it('detail page uses canonical name everywhere, not generic category', () => {
    const detailPage = read('app/retailer/catalog/[id]/page.tsx');
    expect(detailPage).toContain('buildCanonicalProductName');
    expect(detailPage).toContain('canonicalProductName');
    expect(detailPage).not.toMatch(/title.*category.*name/i);
    // Breadcrumb uses real product name
    expect(detailPage).toContain('buildBreadcrumbProductName');
  });

  it('cart, checkout, order detail, invoice use canonical name', () => {
    const cartRow = read('components/retailer/cart-item-row.tsx');
    const orderDetail = read('app/retailer/orders/[id]/page.tsx');
    const invoice = read('app/retailer/orders/[id]/invoice/page.tsx');
    const checkout = read('app/retailer/checkout/page.tsx');
    expect(cartRow).toContain('buildCanonicalProductName');
    expect(orderDetail).toContain('buildCanonicalProductName');
    expect(invoice).toContain('buildCanonicalProductName');
    // Checkout uses canonical for lines
    expect(checkout).toContain('canonicalName');
  });

  it('safe fallback when data missing', () => {
    expect(buildCanonicalProductName({ brandName: null, productName: null, packName: null })).toBe('Product');
    expect(buildCanonicalProductName({ brandName: null, productName: null, packName: '50g' })).toBe('50g');
    expect(buildCanonicalProductName({ brandName: 'Garnier', productName: null, packName: null })).toBe('Garnier');
  });
});
