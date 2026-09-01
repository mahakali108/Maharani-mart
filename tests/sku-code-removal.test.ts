import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(__dirname, '..');

function read(rel: string): string {
  return readFileSync(join(root, rel), 'utf8');
}

/**
 * Maharani Traders does not maintain internal SKU codes for products, so the
 * "SKU code" field was removed from the product workflow.
 *
 * What must stay (backward compatibility, explicitly in scope of the change):
 *   - the `products.sku_code` DATABASE COLUMN (nullable, generated default)
 *   - `product_packs.pack_sku_code`
 *   - `products.barcode` (EAN/UPC)
 *   - `inventory_batches.batch_number` (Batch Code)
 *   - case price / units per case / quantity tiers / GST-inclusive pricing
 */
describe('SKU Code removal — product workflow', () => {
  describe('1. Add / Edit Product form', () => {
    const form = read('components/admin/product-form.tsx');

    it('no longer renders a SKU code input', () => {
      expect(form).not.toContain('name="skuCode"');
      expect(form).not.toContain('SKU code');
      expect(form).not.toContain('sku_code');
    });

    it('still collects the fields that were explicitly kept', () => {
      expect(form).toContain('name="name"');
      expect(form).toContain('name="barcode"');
      expect(form).toContain('name="casePrice"');
      expect(form).toContain('name="unitsPerCase"');
      expect(form).toContain('name="gstPercent"');
      expect(form).toContain('Barcode (EAN/UPC)');
    });
  });

  describe('2. Product create / update server actions', () => {
    const actions = read('lib/admin/products-actions.ts');

    it('does not validate or submit a product SKU code', () => {
      expect(actions).not.toContain('skuCode: z.string()');
      expect(actions).not.toContain("formData.get('skuCode')");
      expect(actions).not.toContain('sku_code: d.skuCode');
    });

    it('never writes products.sku_code — the database default fills it in', () => {
      expect(actions).not.toMatch(/^\s*sku_code:/m);
    });

    it('auto-generates the default pack SKU instead of mirroring the product SKU', () => {
      expect(actions).toContain('function defaultPackSkuCode(productId: string)');
      expect(actions).toContain('pack_sku_code: defaultPackSkuCode(productId)');
    });

    it('resolves the auto-seeded default pack by sort order, not by SKU match', () => {
      expect(actions).not.toContain(".eq('pack_sku_code', d.skuCode)");
      expect(actions).toContain('findDefaultPackId');
    });

    it('keeps the manually managed pack SKU field', () => {
      expect(actions).toContain('packSkuCode');
      expect(actions).toContain('pack_sku_code: d.packSkuCode');
    });

    it('does not change case pricing, units per case or quantity tiers', () => {
      expect(actions).toContain('case_price: d.casePrice');
      expect(actions).toContain('units_per_case: d.unitsPerCase');
      expect(actions).toContain('product_pricing_tiers');
      expect(actions).toContain("rule_type: 'case' as const");
    });
  });

  describe('3. Product-facing surfaces no longer read or show a product SKU', () => {
    const surfaces = [
      'app/admin/products/page.tsx',
      'app/admin/products/[id]/page.tsx',
      'app/retailer/catalog/page.tsx',
      'app/retailer/catalog/[id]/page.tsx',
      'app/retailer/quick-order/page.tsx',
      'app/retailer/cart/page.tsx',
      'app/retailer/orders/[id]/invoice/page.tsx',
      'app/salesman/orders/new/page.tsx',
      'lib/retailer/catalog.ts',
      'lib/retailer/personalization.ts',
      'lib/retailer/search-actions.ts',
      'components/retailer/product-card.tsx',
      'components/retailer/quick-order-row.tsx',
      'components/retailer/search-field.tsx',
      'components/salesman/order-builder.tsx',
    ];

    it.each(surfaces)('%s does not reference products.sku_code', (file) => {
      // `pack_sku_code` is intentionally retained and must not trip this check.
      const source = read(file).replaceAll('pack_sku_code', 'PACK_CODE');
      expect(source).not.toContain('sku_code');
    });

    it('catalog and quick-order search match on name (and brand / category), not SKU', () => {
      expect(read('app/retailer/catalog/page.tsx')).not.toContain('sku_code.ilike');
      expect(read('app/retailer/quick-order/page.tsx')).not.toContain('sku_code.ilike');
      expect(read('app/admin/products/page.tsx')).not.toContain('sku_code.ilike');
      expect(read('lib/retailer/search-actions.ts')).not.toContain('sku_code.ilike');
    });

    it('keeps the pack SKU on the cart line and the salesman pack list', () => {
      expect(read('app/retailer/cart/page.tsx')).toContain('pack_sku_code');
      expect(read('components/salesman/order-builder.tsx')).toContain('pack.skuCode');
    });
  });

  describe('4. Migration 0023 keeps the column for backward compatibility', () => {
    const file = 'supabase/migrations/0023_sku_code_optional.sql';

    it('exists', () => {
      expect(existsSync(join(root, file))).toBe(true);
    });

    it('makes sku_code optional without dropping anything', () => {
      const sql = read(file);
      expect(sql).toContain('alter table products alter column sku_code drop not null;');
      expect(sql.toLowerCase()).toContain('set default');
      expect(sql.toLowerCase()).not.toContain('drop column');
      expect(sql.toLowerCase()).not.toContain('drop table');
    });

    it('does not touch pack_sku_code, barcode or batch numbers', () => {
      const sql = read(file);
      expect(sql).not.toMatch(/alter table product_packs/i);
      expect(sql).not.toMatch(/alter table inventory_batches/i);
      expect(sql).not.toMatch(/alter column barcode/i);
      expect(sql).not.toMatch(/alter column batch_number/i);
    });
  });

  describe('5. Generated database types', () => {
    const types = read('types/database.types.ts');

    it('marks products.sku_code optional on insert', () => {
      expect(types).toContain('sku_code?: string;');
    });

    it('keeps pack_sku_code required on product_packs', () => {
      expect(types).toContain('pack_sku_code: string;');
    });
  });
});
