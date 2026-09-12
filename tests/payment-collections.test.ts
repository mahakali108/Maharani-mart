/**
 * Payment collections (Phase 4) — role matrix verified against the real
 * permission module, plus static checks of the collection actions and the
 * verification → wallet-credit → audit chain.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { can } from '@/lib/permissions/permissions';

const ROOT = join(__dirname, '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

const salesmanActions = read('lib/salesman/collection-actions.ts');
const adminActions = read('lib/admin/collections-actions.ts');
const permissionsSrc = read('lib/permissions/permissions.ts');
const deliveryActions = read('lib/delivery/delivery-actions.ts');

const ROLES = ['super_admin', 'admin', 'staff', 'salesman', 'retailer'] as const;

// ---------------------------------------------------------------------------
// Role matrix for the Phase 4 permissions (gates 2–5)
// ---------------------------------------------------------------------------

describe('Phase 4 permission matrix', () => {
  describe('collections.record', () => {
    it('sales executives and the back office may record collections', () => {
      expect(can('salesman', 'collections.record')).toBe(true);
      expect(can('staff', 'collections.record')).toBe(true);
      expect(can('admin', 'collections.record')).toBe(true);
      expect(can('super_admin', 'collections.record')).toBe(true);
    });

    it('retailers may never record collections', () => {
      expect(can('retailer', 'collections.record')).toBe(false);
    });
  });

  describe('collections.verify (finance control)', () => {
    it('is admin/super_admin ONLY', () => {
      expect(can('admin', 'collections.verify')).toBe(true);
      expect(can('super_admin', 'collections.verify')).toBe(true);
      expect(can('staff', 'collections.verify')).toBe(false);
      expect(can('salesman', 'collections.verify')).toBe(false);
      expect(can('retailer', 'collections.verify')).toBe(false);
    });
  });

  describe('deliveries.execute', () => {
    it('is held by staff, salesmen and admin+', () => {
      expect(can('staff', 'deliveries.execute')).toBe(true);
      expect(can('salesman', 'deliveries.execute')).toBe(true);
      expect(can('admin', 'deliveries.execute')).toBe(true);
      expect(can('super_admin', 'deliveries.execute')).toBe(true);
    });

    it('retailers may never execute deliveries', () => {
      expect(can('retailer', 'deliveries.execute')).toBe(false);
    });
  });

  describe('deliveries.assign', () => {
    it('is held by staff (dispatch desk) and admin+', () => {
      expect(can('staff', 'deliveries.assign')).toBe(true);
      expect(can('admin', 'deliveries.assign')).toBe(true);
      expect(can('super_admin', 'deliveries.assign')).toBe(true);
    });

    it('salesmen and retailers may never assign deliveries', () => {
      expect(can('salesman', 'deliveries.assign')).toBe(false);
      expect(can('retailer', 'deliveries.assign')).toBe(false);
    });
  });

  describe('deliveries.view.assigned', () => {
    it('staff, salesmen and admin+ see assigned deliveries', () => {
      for (const role of ['staff', 'salesman', 'admin', 'super_admin'] as const) {
        expect(can(role, 'deliveries.view.assigned')).toBe(true);
      }
    });

    it('retailers do NOT hold it (they see their own via order visibility)', () => {
      expect(can('retailer', 'deliveries.view.assigned')).toBe(false);
    });
  });

  describe('retailers cannot mutate order/payment/delivery state (gate 4)', () => {
    it('retailer holds none of the mutation permissions', () => {
      const forbidden = [
        'orders.approve',
        'orders.assign',
        'orders.dispatch',
        'orders.deliver',
        'orders.return.manage',
        'retailers.manage_wallet',
        'deliveries.execute',
        'deliveries.assign',
        'collections.record',
        'collections.verify',
      ] as const;
      for (const permission of forbidden) {
        expect(can('retailer', permission)).toBe(false);
      }
    });

    it('the retailer role list in the source contains none of them', () => {
      const retailerBlock = permissionsSrc.match(/retailer: \[([\s\S]*?)\],/)?.[1] ?? '';
      expect(retailerBlock).not.toContain('deliveries.');
      expect(retailerBlock).not.toContain('collections.');
      expect(retailerBlock).not.toContain('orders.dispatch');
      expect(retailerBlock).not.toContain('retailers.manage_wallet');
    });
  });

  describe('admin and super_admin retain full access (gate 5)', () => {
    it('admin covers every Phase 4 permission', () => {
      for (const permission of [
        'deliveries.view.all',
        'deliveries.view.assigned',
        'deliveries.execute',
        'deliveries.assign',
        'collections.record',
        'collections.verify',
      ] as const) {
        expect(can('admin', permission)).toBe(true);
        expect(can('super_admin', permission)).toBe(true);
      }
    });

    it('super_admin keeps team.manage on top of admin (unchanged)', () => {
      expect(can('super_admin', 'team.manage')).toBe(true);
      expect(can('admin', 'team.manage')).toBe(false);
    });
  });

  it('every role has a permission list (no undefined lookups)', () => {
    for (const role of ROLES) {
      expect(can(role, 'products.view')).toBeDefined();
    }
  });
});

// ---------------------------------------------------------------------------
// Salesman collection recording — scope + no wallet writes
// ---------------------------------------------------------------------------

describe('recordCollectionAction', () => {
  it('checks the collections.record permission', () => {
    expect(salesmanActions).toContain("can(user.role, 'collections.record')");
  });

  it('restricts salesmen to retailers assigned to them', () => {
    expect(salesmanActions).toContain('retailer.assigned_salesman_id !== user.id');
    expect(salesmanActions).toContain('only record collections for retailers assigned to you');
  });

  it('validates the amount server-side', () => {
    expect(salesmanActions).toContain('amountPaise <= 0');
  });

  it('rejects proof refs that point outside the retailer\u2019s folder (anti cross-retailer attach)', () => {
    expect(salesmanActions).toContain('isValidPaymentProofRef(input.proofUrl, input.retailerId)');
    expect(salesmanActions).toContain("value.startsWith(`payments/${retailerId}/`)");
    expect(salesmanActions).toContain('!value.includes(\'..\')');
  });

  it('never writes to the wallet ledger', () => {
    expect(salesmanActions).not.toContain('retailer_wallet_ledger');
    expect(salesmanActions).toContain("status: 'pending'");
  });

  it('validates an optional order link belongs to the same retailer', () => {
    expect(salesmanActions).toContain("eq('retailer_id', input.retailerId)");
  });
});

// ---------------------------------------------------------------------------
// Admin verification — credit only on verify, idempotent, audited (gate 12)
// ---------------------------------------------------------------------------

describe('verifyCollectionAction / rejectCollectionAction', () => {
  it('requires collections.verify (finance only)', () => {
    expect(adminActions).toContain("can(user.role, 'collections.verify')");
  });

  it('credits the wallet as PAYMENT_CREDIT with a deterministic idempotency key', () => {
    expect(adminActions).toContain("'PAYMENT_CREDIT'");
    expect(adminActions).toContain('`collection:${collection.id}`');
  });

  it('links the ledger entry back onto the collection row', () => {
    expect(adminActions).toContain('ledger_entry_id: ledgerEntry?.id ?? null');
  });

  it('claims the pending state atomically before crediting', () => {
    expect(adminActions).toContain(".eq('status', 'pending')");
    expect(adminActions).toContain(".select('id')");
  });

  it('reject credits nothing and records the reason', () => {
    const rejectFn = adminActions.match(/export async function rejectCollectionAction[\s\S]*?\n\}/)?.[0] ?? '';
    expect(rejectFn).not.toContain('retailer_wallet_ledger');
    expect(rejectFn).toContain('REJECTED: ');
  });

  it('handles a retried verification via the existing idempotent credit (no double money)', () => {
    expect(adminActions).toContain("'23505'");
    expect(adminActions).toContain('existing credit linked');
  });
});

describe('collection + shortfall audit trail (gate 12)', () => {
  it('payment_collections rows are audited by the DB trigger (0044)', () => {
    const sql44 = read('supabase/migrations/0044_payment_collections.sql');
    expect(sql44).toContain('trg_audit_payment_collections');
  });

  it('delivery + item changes are audited by the DB trigger (0043)', () => {
    const sql43 = read('supabase/migrations/0043_deliveries_module.sql');
    expect(sql43).toContain('trg_audit_order_deliveries');
    expect(sql43).toContain('trg_audit_order_delivery_items');
  });

  it('the shortfall refund is a first-class ledger entry, reversible on RTO', () => {
    expect(deliveryActions).toContain("'REFUND_CREDIT'");
    expect(deliveryActions).toContain('`delivery-shortfall:${delivery.id}`');
  });
});
