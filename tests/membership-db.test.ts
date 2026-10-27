import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { as, createMigratedDb, createUser, errorOf, type Db, type Tx } from './helpers/pg-harness';

/**
 * Paid retailer membership — RETIRED (migration 0083).
 *
 * These tests replace the old "membership purchase works" suite. They assert
 * what the owner asked for after the change:
 *   - no plan is purchasable or even visible to a retailer;
 *   - no API role can grant, renew or extend a membership;
 *   - every historical table/row is retained (nothing deleted);
 *   - the independently useful loyalty ledger still works, at the documented
 *     base rate (1 point per whole ₹100), with no membership multiplier.
 */

let db: Db;
let admin: string;
let retailer1: string;
let retailer2: string;

describe('Paid membership retirement + retained loyalty ledger (PostgreSQL 16)', () => {
  beforeAll(async () => {
    db = await createMigratedDb();
    admin = await createUser(db, 'super_admin', 'Admin User');
    retailer1 = await createUser(db, 'retailer', 'Retailer One');
    retailer2 = await createUser(db, 'retailer', 'Retailer Two');
    await as(db, admin, (tx: Tx) =>
      tx.query(`update retailers set status='active' where id in ($1, $2)`, [retailer1, retailer2])
    );
    await db.query(`insert into public.warehouses (name, is_active) values ('Central Gaya Warehouse', true)`);
  });

  describe('Retirement', () => {
    it('keeps the plan rows for history but deactivates every plan', async () => {
      const all = await db.query<{ id: string; is_active: boolean }>(
        `select id, is_active from public.membership_plans order by id`
      );
      expect(all.rows.map((row) => row.id).sort()).toEqual(['free', 'gold', 'silver']);
      expect(all.rows.every((row) => row.is_active === false)).toBe(true);
    });

    it('shows no purchasable plan to a retailer', async () => {
      const res = await as(db, retailer1, (tx: Tx) => tx.query(`select * from public.membership_plans`));
      expect(res.rows).toHaveLength(0);
    });

    it('withdraws the grant so no API role can grant, renew or extend a membership', async () => {
      for (const who of [retailer1, admin, 'anon']) {
        const message = await errorOf(db, who, (tx: Tx) =>
          tx.query(`select public.admin_set_retailer_membership($1, 'gold')`, [retailer1])
        );
        expect(message).toMatch(/permission denied|could not be executed|Access denied/i);
      }
      const { rows } = await db.query<{ n: string }>(
        `select count(*)::text as n from retailer_memberships where retailer_id = $1`,
        [retailer1]
      );
      expect(rows[0]!.n).toBe('0');
    });

    it('no longer advertises a membership discount anywhere in checkout', () => {
      // The old discount helper had no checkout caller; this asserts the
      // claim did not reappear during the change.
      const quote = readFileSync('lib/orders/quote-order.ts', 'utf8');
      expect(quote).not.toMatch(/membership/i);
      const checkoutPage = readFileSync('app/retailer/checkout/page.tsx', 'utf8');
      expect(checkoutPage).not.toMatch(/membership/i);
    });
  });

  describe('Auditable loyalty ledger (retained)', () => {
    it('prevents direct insert by retailers into the loyalty ledger', async () => {
      const err = await errorOf(db, retailer1, async (tx: Tx) => {
        await tx.query(
          `insert into public.loyalty_ledger (retailer_id, points, entry_type, reason)
           values ($1, 500, 'ORDER_EARN', 'Hacked Points')`,
          [retailer1]
        );
      });
      expect(err).toMatch(/permission denied/i);
    });

    it('allows an admin to award points with idempotency protection', async () => {
      const key = 'test:award:1';
      await as(db, admin, (tx: Tx) =>
        tx.query(
          `select public.record_loyalty_points($1, 100, 'ORDER_EARN', 'Order #101 award', 'order', null, $2)`,
          [retailer1, key]
        )
      );
      const balance = async () => {
        const res = await as(db, retailer1, (tx: Tx) =>
          tx.query<{ b: number }>(`select public.get_retailer_loyalty_balance($1) as b`, [retailer1])
        );
        return res.rows[0]?.b;
      };
      expect(await balance()).toBe(100);
      await as(db, admin, (tx: Tx) =>
        tx.query(
          `select public.record_loyalty_points($1, 100, 'ORDER_EARN', 'Order #101 retry', 'order', null, $2)`,
          [retailer1, key]
        )
      );
      expect(await balance()).toBe(100);
    });

    it('prevents negative balances on deduction', async () => {
      const err = await errorOf(db, admin, async (tx: Tx) => {
        await tx.query(
          `select public.record_loyalty_points($1, -200, 'REDEMPTION', 'Overspend', 'manual')`,
          [retailer1]
        );
      });
      expect(err).toMatch(/INSUFFICIENT_LOYALTY_POINTS/);
    });

    it('enforces tenant isolation on the ledger', async () => {
      const res = await as(db, retailer2, async (tx: Tx) => {
        return tx.query(`select * from public.loyalty_ledger where retailer_id = $1`, [retailer1]);
      });
      expect(res.rows).toHaveLength(0);
    });
  });

  describe('Migration replay', () => {
    it('replays migration 0080 without duplicate-object errors', async () => {
      const sql = readFileSync('supabase/migrations/0080_retailer_memberships_and_loyalty.sql', 'utf8');
      await db.exec(sql);
    });

    it('replays migration 0083 (retirement) without error', async () => {
      const sql = readFileSync('supabase/migrations/0083_retire_paid_membership.sql', 'utf8');
      await db.exec(sql);
      const { rows } = await db.query<{ n: string }>(`select count(*)::text as n from membership_plans where is_active`);
      expect(rows[0]!.n).toBe('0');
    });
  });

  describe('Delivered-order accrual (base rate, no membership multiplier)', () => {
    it('awards 1 point per whole ₹100 and reverses on return', async () => {
      const orderId = 'b0000000-0000-0000-0000-000000000001';
      await as(db, 'service', (tx: Tx) =>
        tx.query(
          `insert into public.orders (id, order_number, retailer_id, status, subtotal, gst_total, discount_total, grand_total)
           values ($1, 'ORD-DELIV-1', $2, 'dispatched', 1271.19, 228.81, 0, 1500.00)`,
          [orderId, retailer1]
        )
      );

      const balance = async () => {
        const res = await as(db, retailer1, (tx: Tx) =>
          tx.query<{ b: number }>(`select public.get_retailer_loyalty_balance($1) as b`, [retailer1])
        );
        return res.rows[0]?.b ?? 0;
      };
      const initial = await balance();

      await as(db, 'service', (tx: Tx) => tx.query(`update public.orders set status = 'delivered' where id = $1`, [orderId]));
      // ₹1500 → 15 base points. No multiplier: the paid-membership boost is retired.
      expect(await balance()).toBe(initial + 15);

      await as(db, 'service', (tx: Tx) =>
        tx.query(`update public.orders set status = 'delivered', notes = 're-saved' where id = $1`, [orderId])
      );
      expect(await balance()).toBe(initial + 15);

      await as(db, 'service', (tx: Tx) => tx.query(`update public.orders set status = 'returned' where id = $1`, [orderId]));
      expect(await balance()).toBe(initial);
    });
  });
});
