import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(__dirname, '..');
const migration = readFileSync(join(root, 'supabase/migrations/0086_catalog_seller_compliance_enforcement.sql'), 'utf8');
const productActions = readFileSync(join(root, 'lib/admin/products-actions.ts'), 'utf8');
const importActions = readFileSync(join(root, 'lib/admin/product-import-actions.ts'), 'utf8');
const sellerActions = readFileSync(join(root, 'lib/seller/actions.ts'), 'utf8');
const quoteOrder = readFileSync(join(root, 'lib/orders/quote-order.ts'), 'utf8');

describe('Phase 2D database-backed catalogue and seller enforcement', () => {
  it('blocks Food and unknown category scope at the product database boundary, not only in a form', () => {
    expect(migration).toContain("compliance_scope in ('cosmetics', 'fmcg', 'food_blocked', 'unapproved')");
    expect(migration).toContain("CATALOG_CATEGORY_BLOCKED: only owner-classified Cosmetics and FMCG categories may contain products.");
    expect(migration).toContain("Food categories cannot be classified as Cosmetics or FMCG.");
    expect(migration).toContain('before insert or update on public.products');
    expect(productActions).toContain('checkAllowedCatalogCategory');
    expect(importActions).toContain('ALLOWED_CATALOG_SCOPES');
  });

  it('requires reviewed, unexpired product evidence before publication, retailer visibility, or a new order line', () => {
    expect(migration).toContain('assert_product_compliance_approvable');
    expect(migration).toContain('PRODUCT_COMPLIANCE_REQUIRED: product publication requires an approved, unexpired Cosmetics/FMCG compliance review.');
    expect(migration).toContain('before insert or update on public.product_packs');
    expect(migration).toContain('before insert on public.order_items');
    expect(migration).toContain('public.product_is_sale_eligible(id)');
    expect(migration).toContain('SECURITY DEFINER retailer projections must independently carry the same');
    expect(migration).toContain('public.seller_is_trade_eligible(so.seller_id)');
    expect(quoteOrder).toContain("'product_is_sale_eligible'");
    expect(migration).toContain("'label_photo', 'supplier_invoice'");
    expect(migration).toContain("'manufacturing_licence', 'import_registration'");
  });

  it('requires Super Admin-reviewed seller evidence before activation or offer publication', () => {
    expect(migration).toContain("(r.expires_at is null or r.expires_at > clock_timestamp())");
    expect(migration).toContain('assert_seller_compliance_approvable');
    expect(migration).toContain('SELLER_COMPLIANCE_REQUIRED: seller activation requires an approved, unexpired compliance review.');
    expect(migration).toContain('SELLER_COMPLIANCE_REQUIRED: an unverified or expired seller cannot create or publish an offer.');
    expect(migration).toContain('Only a Super Admin may change seller compliance review state.');
    expect(sellerActions).toContain('checkSellerCanTrade');
  });

  it('keeps compliance evidence private and owner-scoped under RLS', () => {
    expect(migration).toContain('storage_object_key !~*');
    expect(migration).toContain('product_compliance_evidence_seller_own');
    expect(migration).toContain('seller_compliance_evidence_seller_own_insert');
    expect(migration).toContain('public.is_member_of_seller(seller_id)');
    expect(migration).toContain('product_compliance_review_audit');
    expect(migration).toContain('seller_compliance_review_audit');
  });

  it('preserves historical orders while protecting new order-line inserts', () => {
    expect(migration).toContain('before insert on public.order_items');
    expect(migration).not.toContain('before update on public.order_items\nfor each row execute function public.enforce_order_item_compliance');
    expect(migration).toContain('Existing order rows are untouched.');
  });

  it('provides a non-mutating report for historical records that need owner review', () => {
    expect(migration).toContain('catalog_compliance_review_report');
    expect(migration).toContain('get_catalog_compliance_review_report');
    expect(migration).toContain('Only an authenticated Super Admin can read the catalogue compliance review report.');
    expect(migration).toContain('Existing categories are deliberately initialized as `unapproved`');
    expect(migration).toContain('it does not certify or alter historical data');
  });
});
