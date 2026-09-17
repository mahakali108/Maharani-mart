import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(__dirname, '..');

function read(rel: string): string {
  return readFileSync(join(root, rel), 'utf-8');
}

/**
 * Phase 4 — product media audit-log and safety review.
 *
 * Product media lives in three columns (product_images.image_url,
 * product_pack_images.image_url, product_packs.image_url) that all point at
 * objects in the `product-images` Storage bucket. These tests lock in the
 * safety rules so a future edit cannot quietly reintroduce the gaps:
 *
 *   1. Only renderable refs may enter a product-media column.
 *   2. An image row delete is scoped to its owning product/pack.
 *   3. A Storage object is only deleted when no row still references it
 *      (duplicatePackAction shares objects between rows).
 *   4. Product/pack deletes collect refs before the FK cascade and clean the
 *      files up afterwards — rows cascade, files do not.
 *   5. Every product-media row mutation stays audited (0050 triggers).
 *   6. No service-role client anywhere near the media actions.
 */
describe('product media safety — server actions', () => {
  const actions = read('lib/admin/products-actions.ts');

  it('rejects non-renderable refs on the product gallery, like the pack gallery already did', () => {
    // addProductImageAction must gate on isRenderableMediaRef BEFORE any insert.
    const addProduct = actions.slice(
      actions.indexOf('export async function addProductImageAction'),
      actions.indexOf('export async function removeProductImageAction')
    );
    expect(addProduct).toContain("if (!isRenderableMediaRef(imageUrl)) throw new Error('Invalid image reference.')");
    expect(addProduct).toContain('Invalid image reference.');
    // And it must verify the product exists rather than surfacing a raw FK error.
    expect(addProduct).toContain("if (!product) throw new Error('Product not found.')");
  });

  it('scopes the product-image delete to the owning product', () => {
    const removeProduct = actions.slice(
      actions.indexOf('export async function removeProductImageAction'),
      actions.indexOf('export async function reorderProductImageAction')
    );
    // The delete chain must carry both filters; a mismatched imageId/productId
    // pair must remove nothing.
    expect(removeProduct).toContain(".eq('id', imageId)");
    expect(removeProduct).toContain(".eq('product_id', productId)");
  });

  it('never calls the raw deleteMedia() directly anymore — every cleanup is guarded', () => {
    // All file cleanups must go through the reference-aware helpers, so a
    // shared object (duplicated pack) is never deleted out from under a row
    // that still shows it.
    const callSites = actions.match(/await deleteMedia\(/g) ?? [];
    expect(callSites).toHaveLength(0);
    expect(actions).toContain('await deleteMediaIfUnreferenced(supabase, data.image_url);');
    expect(actions).toContain('await deleteMediaIfUnreferenced(supabase, pack.image_url);');
  });

  it('collects refs before the product delete and cleans up after it', () => {
    const deleteProduct = actions.slice(
      actions.indexOf('export async function deleteProductAction'),
      actions.indexOf('// ----------------------------------------------------------------------------\n// Product images')
    );
    const collectAt = deleteProduct.indexOf('await collectProductMediaRefs(supabase, productId)');
    const deleteAt = deleteProduct.indexOf("await supabase.from('products').delete()");
    const cleanupAt = deleteProduct.indexOf('await cleanupMediaRefsBestEffort(supabase, refs)');
    const redirectAt = deleteProduct.indexOf("redirect('/admin/products')");
    expect(collectAt).toBeGreaterThanOrEqual(0);
    expect(deleteAt).toBeGreaterThan(collectAt);
    expect(cleanupAt).toBeGreaterThan(deleteAt);
    expect(redirectAt).toBeGreaterThan(cleanupAt);
  });

  it('collects refs before the pack delete and cleans up after it', () => {
    const deletePack = actions.slice(
      actions.indexOf('export async function deleteProductPackAction'),
      actions.indexOf('/**\n * Sets or clears')
    );
    const collectAt = deletePack.indexOf('await collectPackMediaRefs(supabase, packId)');
    const deleteAt = deletePack.indexOf("await supabase.from('product_packs').delete()");
    const cleanupAt = deletePack.indexOf('await cleanupMediaRefsBestEffort(supabase, refs)');
    expect(collectAt).toBeGreaterThanOrEqual(0);
    expect(deleteAt).toBeGreaterThan(collectAt);
    expect(cleanupAt).toBeGreaterThan(deleteAt);
  });
});

describe('product media safety — shared reference guard', () => {
  const helpers = read('lib/admin/product-media.ts');

  it('scans all three product-media columns before declaring a file unreferenced', () => {
    expect(helpers).toContain("{ table: 'product_images', column: 'image_url' }");
    expect(helpers).toContain("{ table: 'product_pack_images', column: 'image_url' }");
    expect(helpers).toContain("{ table: 'product_packs', column: 'image_url' }");
  });

  it('keeps cleanup best-effort so a Storage outage cannot fail a finished DB delete', () => {
    const cleanup = helpers.slice(helpers.indexOf('export async function cleanupMediaRefsBestEffort'));
    expect(cleanup).toContain('try {');
    expect(cleanup).toContain('} catch {');
  });

  it('stays on the caller session — no service-role client in the media path', () => {
    expect(helpers).not.toContain('createServiceRoleClient');
    expect(helpers).not.toContain('SUPABASE_SERVICE_ROLE_KEY');
    const actions = read('lib/admin/products-actions.ts');
    expect(actions).not.toContain('createServiceRoleClient');
    expect(actions).not.toContain('SUPABASE_SERVICE_ROLE_KEY');
  });
});

describe('product media audit coverage — 0050 triggers stay in place', () => {
  const migration = read('supabase/migrations/0050_catalog_admin_upgrade.sql');

  it('audits every product_images mutation', () => {
    expect(migration).toContain('create trigger trg_audit_product_images after insert or update or delete on product_images');
  });

  it('audits every product_pack_images mutation', () => {
    expect(migration).toContain(
      'create trigger trg_audit_product_pack_images after insert or update or delete on product_pack_images'
    );
  });

  it('uses the shared log_audit() function — no second audit pipeline', () => {
    expect(migration).toContain('for each row execute function log_audit();');
    // And no NEW audit trigger on these tables appears outside 0050.
    const migrations = [
      '0001_init.sql',
      '0004_product_packs.sql',
      '0005_master_data_delete_and_pricing.sql',
      '0024_pack_variant_images.sql',
      '0028_product_pack_gallery.sql',
    ];
    for (const name of migrations) {
      const sql = read(`supabase/migrations/${name}`);
      expect(sql).not.toContain('trg_audit_product_images');
      expect(sql).not.toContain('trg_audit_product_pack_images');
    }
  });
});
