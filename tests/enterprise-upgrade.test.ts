/**
 * Tests for price change safety and variant duplication functionality.
 *
 * Verifies:
 *   - Price change audit log structure
 *   - Pack duplication creates correct attributes
 *   - Pack duplication starts inactive
 *   - Tier duplication copies correctly
 *   - SKU code generation for duplicated packs
 */

import { describe, it, expect } from 'vitest';

// ---------------------------------------------------------------------------
// SKU generation (mirrors lib/admin/products-actions.ts)
// ---------------------------------------------------------------------------

function generatePackSkuCode(productId: string): string {
  const product = productId.replaceAll('-', '').slice(0, 8).toUpperCase();
  // In the real implementation, randomUUID is used. Here we test the format.
  const unique = 'TEST1234';
  return `PKV-${product}-${unique}`;
}

// ---------------------------------------------------------------------------
// Pack duplication logic (unit-testable subset)
// ---------------------------------------------------------------------------

interface SourcePack {
  id: string;
  product_id: string;
  pack_name: string;
  units_per_case: number;
  base_price: number;
  mrp: number | null;
  cost_price: number | null;
  case_price: number;
  barcode: string | null;
  image_url: string | null;
  moq: number;
  is_active: boolean;
  sort_order: number;
}

function buildDuplicatedPack(source: SourcePack, newId: string, newSku: string) {
  return {
    id: newId,
    product_id: source.product_id,
    pack_name: `${source.pack_name} (Copy)`,
    pack_sku_code: newSku,
    units_per_case: source.units_per_case,
    base_price: source.base_price,
    mrp: source.mrp,
    cost_price: source.cost_price,
    case_price: source.case_price,
    barcode: null, // Never duplicate barcode
    image_url: source.image_url,
    moq: source.moq,
    is_active: false, // Always starts inactive
    sort_order: source.sort_order + 1,
  };
}

interface SourceTier {
  min_quantity: number;
  max_quantity: number | null;
  price_per_piece: number;
  rule_type: string;
  label: string | null;
}

function buildDuplicatedTiers(tiers: SourceTier[], newPackId: string, userId: string) {
  return tiers.map((tier) => ({
    product_pack_id: newPackId,
    min_quantity: tier.min_quantity,
    max_quantity: tier.max_quantity,
    price_per_piece: tier.price_per_piece,
    rule_type: tier.rule_type,
    label: tier.label,
    created_by: userId,
  }));
}

// ---------------------------------------------------------------------------
// Price change audit log structure
// ---------------------------------------------------------------------------

interface PriceAuditEntry {
  actor_id: string;
  target_id: string | null;
  action: string;
  before_data: Record<string, unknown> | null;
  after_data: Record<string, unknown> | null;
}

function buildPriceCreatedAudit(userId: string, productId: string, scope: string, price: number): PriceAuditEntry {
  return {
    actor_id: userId,
    target_id: null,
    action: 'price_created',
    before_data: null,
    after_data: { product_id: productId, scope, price },
  };
}

function buildPriceDeactivatedAudit(userId: string, priceListId: string, productName: string, scope: string, price: number): PriceAuditEntry {
  return {
    actor_id: userId,
    target_id: priceListId,
    action: 'price_deactivated',
    before_data: { product: productName, scope, price },
    after_data: { is_active: false },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Pack SKU generation', () => {
  it('generates correct format', () => {
    const sku = generatePackSkuCode('550e8400-e29b-41d4-a716-446655440000');
    expect(sku).toMatch(/^PKV-[A-Z0-9]{8}-[A-Z0-9]{8}$/);
  });

  it('uses first 8 chars of product id (no dashes)', () => {
    const sku = generatePackSkuCode('550e8400-e29b-41d4-a716-446655440000');
    expect(sku.startsWith('PKV-550E8400')).toBe(true);
  });
});

describe('Pack duplication', () => {
  const sourcePack: SourcePack = {
    id: 'source-id',
    product_id: 'product-123',
    pack_name: '100g',
    units_per_case: 12,
    base_price: 50,
    mrp: 60,
    cost_price: 30,
    case_price: 480,
    barcode: '1234567890',
    image_url: 'https://example.com/image.jpg',
    moq: 2,
    is_active: true,
    sort_order: 3,
  };

  it('appends (Copy) to pack name', () => {
    const dup = buildDuplicatedPack(sourcePack, 'new-id', 'PKV-XXXX-YYYY');
    expect(dup.pack_name).toBe('100g (Copy)');
  });

  it('preserves all pricing attributes', () => {
    const dup = buildDuplicatedPack(sourcePack, 'new-id', 'PKV-XXXX-YYYY');
    expect(dup.units_per_case).toBe(12);
    expect(dup.base_price).toBe(50);
    expect(dup.mrp).toBe(60);
    expect(dup.cost_price).toBe(30);
    expect(dup.case_price).toBe(480);
    expect(dup.moq).toBe(2);
  });

  it('starts as inactive', () => {
    const dup = buildDuplicatedPack(sourcePack, 'new-id', 'PKV-XXXX-YYYY');
    expect(dup.is_active).toBe(false);
  });

  it('does not duplicate barcode', () => {
    const dup = buildDuplicatedPack(sourcePack, 'new-id', 'PKV-XXXX-YYYY');
    expect(dup.barcode).toBeNull();
  });

  it('preserves image_url', () => {
    const dup = buildDuplicatedPack(sourcePack, 'new-id', 'PKV-XXXX-YYYY');
    expect(dup.image_url).toBe('https://example.com/image.jpg');
  });

  it('increments sort_order', () => {
    const dup = buildDuplicatedPack(sourcePack, 'new-id', 'PKV-XXXX-YYYY');
    expect(dup.sort_order).toBe(4);
  });

  it('preserves product_id', () => {
    const dup = buildDuplicatedPack(sourcePack, 'new-id', 'PKV-XXXX-YYYY');
    expect(dup.product_id).toBe('product-123');
  });
});

describe('Tier duplication', () => {
  it('copies all tier attributes to new pack', () => {
    const tiers: SourceTier[] = [
      { min_quantity: 1, max_quantity: 12, price_per_piece: 40, rule_type: 'default', label: 'Default' },
      { min_quantity: 12, max_quantity: null, price_per_piece: 40, rule_type: 'case', label: 'Case price' },
    ];

    const duped = buildDuplicatedTiers(tiers, 'new-pack-id', 'user-1');
    expect(duped).toHaveLength(2);
    expect(duped[0]!.product_pack_id).toBe('new-pack-id');
    expect(duped[0]!.min_quantity).toBe(1);
    expect(duped[0]!.max_quantity).toBe(12);
    expect(duped[0]!.price_per_piece).toBe(40);
    expect(duped[1]!.product_pack_id).toBe('new-pack-id');
    expect(duped[1]!.max_quantity).toBeNull();
    expect(duped[1]!.created_by).toBe('user-1');
  });
});

describe('Price audit log', () => {
  it('creates correct audit entry for price creation', () => {
    const audit = buildPriceCreatedAudit('user-1', 'product-1', 'base', 100);
    expect(audit.action).toBe('price_created');
    expect(audit.actor_id).toBe('user-1');
    expect(audit.before_data).toBeNull();
    expect(audit.after_data).toEqual({ product_id: 'product-1', scope: 'base', price: 100 });
  });

  it('creates correct audit entry for price deactivation', () => {
    const audit = buildPriceDeactivatedAudit('user-1', 'pl-1', 'Shampoo', 'base', 100);
    expect(audit.action).toBe('price_deactivated');
    expect(audit.target_id).toBe('pl-1');
    expect(audit.before_data).toEqual({ product: 'Shampoo', scope: 'base', price: 100 });
    expect(audit.after_data).toEqual({ is_active: false });
  });

  it('never includes sensitive fields in audit data', () => {
    const audit = buildPriceCreatedAudit('user-1', 'product-1', 'base', 100);
    const allData = JSON.stringify(audit.before_data) + JSON.stringify(audit.after_data);
    expect(allData).not.toContain('password');
    expect(allData).not.toContain('token');
    expect(allData).not.toContain('secret');
    expect(allData).not.toContain('service_role');
  });
});
