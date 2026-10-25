import { beforeAll, describe, expect, it } from 'vitest';
import { as, createMigratedDb, createUser, errorOf, type Db, type Tx } from './helpers/pg-harness';

let db: Db;
let admin: string;
let retailer1: string;
let retailer2: string;

describe('0080 Retailer Memberships & Loyalty Schema (PostgreSQL 16 PGlite)', () => {
  beforeAll(async () => {
    db = await createMigratedDb();

    // Create admin user and promote to active
    admin = await createUser(db, 'super_admin', 'Admin User');

    // Create two test retailers
    retailer1 = await createUser(db, 'retailer', 'Retailer One');
    retailer2 = await createUser(db, 'retailer', 'Retailer Two');

    // Activate the retailers
    await as(db, admin, (tx: Tx) =>
      tx.query(`update retailers set status='active' where id in ($1, $2)`, [retailer1, retailer2])
    );
  });

  describe('Membership Plans & RLS', () => {
    it('has default Free, Silver, Gold membership plans preloaded', async () => {
      const res = await as(db, 'anon', async (tx: Tx) => {
        return tx.query(`select * from public.membership_plans order by price_paise asc`);
      });
      // anon should return 0 rows due to RLS
      expect(res.rows.length).toBe(0);

      // Authenticated retailer can read active plans
      const authRes = await as(db, retailer1, async (tx: Tx) => {
        return tx.query(`select * from public.membership_plans order by price_paise asc`);
      });
      expect(authRes.rows.length).toBe(3);
      expect(authRes.rows.map((r: any) => r.id)).toEqual(['free', 'silver', 'gold']);
    });

    it('prevents non-admin retailers from modifying or inserting plans', async () => {
      const err = await errorOf(db, retailer1, async (tx: Tx) => {
        await tx.query(`
          insert into public.membership_plans (id, tier, name, duration_days)
          values ('platinum', 'gold', 'Hacked Tier', 30)
        `);
      });
      expect(err).toBeDefined();
    });

    it('allows Admin to modify plan pricing and benefits', async () => {
      await as(db, admin, async (tx: Tx) => {
        await tx.query(`
          update public.membership_plans
          set discount_percent = 2.50
          where id = 'silver'
        `);
      });

      const res = await as(db, retailer1, async (tx: Tx) => {
        return tx.query<{ discount_percent: string }>(`select discount_percent from public.membership_plans where id = 'silver'`);
      });
      expect(Number(res.rows[0]?.discount_percent)).toBe(2.50);
    });
  });

  describe('Authoritative Membership Assignment & Expiry Boundary', () => {
    it('returns empty/default when retailer has no active membership assigned', async () => {
      const res = await as(db, retailer1, async (tx: Tx) => {
        return tx.query(`select * from public.get_active_retailer_membership($1)`, [retailer1]);
      });
      expect(res.rows.length).toBe(0);
    });

    it('prevents retailers from assigning memberships to themselves via RPC', async () => {
      const err = await errorOf(db, retailer1, async (tx: Tx) => {
        await tx.query(`
          select public.admin_set_retailer_membership($1, 'gold')
        `, [retailer1]);
      });
      expect(err).toMatch(/Super Admin or Admin authorization required/);
    });

    it('allows Admin to assign Silver membership and confirms active status', async () => {
      await as(db, admin, async (tx: Tx) => {
        await tx.query(`
          select public.admin_set_retailer_membership($1, 'silver', 'Upgraded by Admin')
        `, [retailer1]);
      });

      const res = await as(db, retailer1, async (tx: Tx) => {
        return tx.query<{ tier: string; status: string }>(`select * from public.get_active_retailer_membership($1)`, [retailer1]);
      });
      expect(res.rows.length).toBe(1);
      expect(res.rows[0]?.tier).toBe('silver');
      expect(res.rows[0]?.status).toBe('active');
    });

    it('immediately ceases membership benefits if expires_at is in the past', async () => {
      // Manually set expiry to the past
      await as(db, admin, async (tx: Tx) => {
        await tx.query(`
          update public.retailer_memberships
          set expires_at = now() - interval '1 hour'
          where retailer_id = $1 and status = 'active'
        `, [retailer1]);
      });

      const res = await as(db, retailer1, async (tx: Tx) => {
        return tx.query(`select * from public.get_active_retailer_membership($1)`, [retailer1]);
      });
      expect(res.rows.length).toBe(0); // benefits stopped authoritatively
    });

    it('prevents cross-user membership reads via RPC', async () => {
      const err = await errorOf(db, retailer2, async (tx: Tx) => {
        await tx.query(`select * from public.get_active_retailer_membership($1)`, [retailer1]);
      });
      expect(err).toMatch(/Access denied/);
    });
  });

  describe('Auditable Loyalty Points Ledger', () => {
    it('prevents direct insert by retailers or anon into loyalty ledger', async () => {
      const err = await errorOf(db, retailer1, async (tx: Tx) => {
        await tx.query(`
          insert into public.loyalty_ledger (retailer_id, points, entry_type, reason)
          values ($1, 500, 'ORDER_EARN', 'Hacked Points')
        `, [retailer1]);
      });
      expect(err).toMatch(/permission denied/);
    });

    it('allows Admin to award points with idempotency protection', async () => {
      const key = 'test:award:1';
      await as(db, admin, async (tx: Tx) => {
        await tx.query(`
          select public.record_loyalty_points($1, 100, 'ORDER_EARN', 'Order #101 award', 'order', null, $2)
        `, [retailer1, key]);
      });

      const balRes = await as(db, retailer1, async (tx: Tx) => {
        return tx.query<{ get_retailer_loyalty_balance: number }>(`select public.get_retailer_loyalty_balance($1)`, [retailer1]);
      });
      expect(balRes.rows[0]?.get_retailer_loyalty_balance).toBe(100);

      // Replay identical idempotency key -> no double award
      await as(db, admin, async (tx: Tx) => {
        await tx.query(`
          select public.record_loyalty_points($1, 100, 'ORDER_EARN', 'Order #101 retry', 'order', null, $2)
        `, [retailer1, key]);
      });

      const balRes2 = await as(db, retailer1, async (tx: Tx) => {
        return tx.query<{ get_retailer_loyalty_balance: number }>(`select public.get_retailer_loyalty_balance($1)`, [retailer1]);
      });
      expect(balRes2.rows[0]?.get_retailer_loyalty_balance).toBe(100);
    });

    it('prevents negative balances on deduction', async () => {
      const err = await errorOf(db, admin, async (tx: Tx) => {
        await tx.query(`
          select public.record_loyalty_points($1, -200, 'REDEMPTION', 'Overspend', 'manual')
        `, [retailer1]);
      });
      expect(err).toMatch(/INSUFFICIENT_LOYALTY_POINTS/);
    });

    it('enforces tenant isolation: retailer cannot see another retailer ledger', async () => {
      const res = await as(db, retailer2, async (tx: Tx) => {
        return tx.query(`select * from public.loyalty_ledger where retailer_id = $1`, [retailer1]);
      });
      expect(res.rows.length).toBe(0);
    });
  });
});

  describe('Migration Idempotency & Concurrency', () => {
    it('executes 0080 migration repeatedly without duplicate object errors', async () => {
      const { readFileSync } = await import('node:fs');
      const sql = readFileSync('supabase/migrations/0080_retailer_memberships_and_loyalty.sql', 'utf8');
      let error: Error | null = null;
      try {
        await db.exec(sql);
      } catch (err: any) {
        error = err;
      }
      expect(error).toBeNull();
    });
  });
