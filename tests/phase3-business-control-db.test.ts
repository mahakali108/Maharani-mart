import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import {
  approveAndActivateSeller,
  as,
  createMigratedDb,
  createPack,
  createRetailer,
  createUser,
  publishProduct,
  type Tx,
} from './helpers/pg-harness';

async function expectFail(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
  throw new Error('Expected promise to reject, but it resolved.');
}

describe('Phase 3 — Super Admin Business Control, RLS, Triggers & Rollback (PostgreSQL 16)', () => {
  let db: PGlite;
  let superAdminId: string;
  let adminId: string;
  let retailer1Id: string;
  let retailer2Id: string;
  let sellerOwnerId: string;
  let otherSellerOwnerId: string;

  let sellerId: string;
  let otherSellerId: string;
  let productId: string;
  let packId: string;
  let offerId: string;

  beforeAll(async () => {
    db = await createMigratedDb();

    superAdminId = await createUser(db, 'super_admin', 'Phase3 Owner');
    adminId = await createUser(db, 'admin', 'Phase3 Admin');
    retailer1Id = (await createRetailer(db)).id;
    retailer2Id = (await createRetailer(db)).id;
    sellerOwnerId = await createUser(db, 'seller', 'Phase3 Seller 1');
    otherSellerOwnerId = await createUser(db, 'seller', 'Phase3 Seller 2');

    const packFixture = await createPack(db, { publish: false });
    productId = packFixture.productId;
    packId = packFixture.packId;

    await as(db, 'service', async (tx: Tx) => {
      await tx.query(
        `update public.products
            set description = 'Gentle herbal bar for wholesale supply'
          where id = $1`,
        [productId]
      );
      await tx.query(
        `update public.product_packs
            set base_price = 100.00, mrp = 120.00
          where id = $1`,
        [packId]
      );
    });
    await publishProduct(db, productId);

    await as(db, 'service', async (tx: Tx) => {
      // Sellers + members
      const { rows: s1 } = await tx.query<{ id: string }>(
        `insert into public.sellers (business_name, contact_name, phone, email, status)
         values ('Phase3 Seller Co', 'Owner One', '9000000305', 'p3seller1@example.com', 'pending')
         returning id`
      );
      sellerId = s1[0]!.id;
      await tx.query(
        `insert into public.seller_members (seller_id, profile_id, member_role)
         values ($1, $2, 'owner')`,
        [sellerId, sellerOwnerId]
      );

      const { rows: s2 } = await tx.query<{ id: string }>(
        `insert into public.sellers (business_name, contact_name, phone, email, status)
         values ('Phase3 Other Seller', 'Owner Two', '9000000306', 'p3seller2@example.com', 'pending')
         returning id`
      );
      otherSellerId = s2[0]!.id;
      await tx.query(
        `insert into public.seller_members (seller_id, profile_id, member_role)
         values ($1, $2, 'owner')`,
        [otherSellerId, otherSellerOwnerId]
      );
    });
    await approveAndActivateSeller(db, otherSellerId, superAdminId);
  }, 60_000);

  afterAll(async () => {
    await db?.close();
  });

  describe('1. Seller governance & anti-self-approval', () => {
    it('blocks seller self-approval and regular admin seller status updates, allows Super Admin approve/suspend/reinstate', async () => {
      // Seller cannot approve themselves
      await expectFail(
        as(db, sellerOwnerId, (tx: Tx) =>
          tx.query(`update public.sellers set status = 'active' where id = $1 returning id`, [sellerId])
        ).then((res) => {
          if (res.rows.length === 0) throw new Error('RLS silently blocked seller self-approval');
        })
      );

      // Regular admin cannot approve sellers (0072 Super Admin lockdown)
      await expectFail(
        as(db, adminId, (tx: Tx) =>
          tx.query(`update public.sellers set status = 'active' where id = $1 returning id`, [sellerId])
        ).then((res) => {
          if (res.rows.length === 0) throw new Error('RLS blocked regular admin seller update');
        })
      );

      // Super Admin approves seller compliance & activates seller -> active
      await approveAndActivateSeller(db, sellerId, superAdminId);
      const approved = await as(db, superAdminId, (tx: Tx) =>
        tx.query<{ status: string }>(`select status from public.sellers where id = $1`, [sellerId])
      );
      expect(approved.rows[0]?.status).toBe('active');

      // Super Admin suspends seller -> suspended
      const suspended = await as(db, superAdminId, (tx: Tx) =>
        tx.query<{ status: string }>(
          `update public.sellers set status = 'suspended', suspension_reason = 'Audit check required' where id = $1 returning status`,
          [sellerId]
        )
      );
      expect(suspended.rows[0]?.status).toBe('suspended');

      // Super Admin reinstates seller -> active
      const reinstated = await as(db, superAdminId, (tx: Tx) =>
        tx.query<{ status: string }>(
          `update public.sellers set status = 'active' where id = $1 returning status`,
          [sellerId]
        )
      );
      expect(reinstated.rows[0]?.status).toBe('active');
    });
  });

  describe('2. Product description privilege preservation & immutable moderation history', () => {
    it('exposes products.description to authenticated retailers while keeping products.cost_price locked down', async () => {
      const retailerDesc = await as(db, retailer1Id, (tx: Tx) =>
        tx.query<{ description: string | null }>(
          `select description from public.products where id = $1`,
          [productId]
        )
      );
      expect(retailerDesc.rows[0]?.description).toBe('Gentle herbal bar for wholesale supply');

      // anon has column SELECT privilege on description (does not throw permission denied),
      // while cost_price fails with permission denied for BOTH anon and authenticated.
      await as(db, 'anon', (tx: Tx) =>
        tx.query<{ description: string | null }>(
          `select description from public.products where id = $1`,
          [productId]
        )
      );

      // cost_price must remain inaccessible (0107 column lockdown preserved)
      expect(
        await expectFail(
          as(db, retailer1Id, (tx: Tx) =>
            tx.query(`select cost_price from public.products where id = $1`, [productId])
          )
        )
      ).toMatch(/permission denied/i);

      expect(
        await expectFail(
          as(db, 'anon', (tx: Tx) =>
            tx.query(`select cost_price from public.products where id = $1`, [productId])
          )
        )
      ).toMatch(/permission denied/i);
    });

    it('auto-logs offer rejection/prohibited removal into append-only product_moderation_history', async () => {
      // Seed an offer directly via service so we don't open the marketplace launch gate
      await as(db, 'service', async (tx: Tx) => {
        const { rows } = await tx.query<{ id: string }>(
          `insert into public.seller_offers (
             seller_id, product_id, pack_id, fulfilment_type,
             unit_price_paise, moq, stock_quantity, moderation_status, is_active
           ) values (
             $1, $2, $3, 'seller', 9500, 2, 50, 'pending', false
           ) returning id`,
          [sellerId, productId, packId]
        );
        offerId = rows[0]!.id;
      });

      // Super Admin removes offer as prohibited
      await as(db, superAdminId, (tx: Tx) =>
        tx.query(
          `update public.seller_offers
              set moderation_status = 'rejected',
                  is_active = false,
                  moderation_reason = '[PROHIBITED] Counterfeit packaging reported'
            where id = $1`,
          [offerId]
        )
      );

      const history = await as(db, superAdminId, (tx: Tx) =>
        tx.query<{ id: string; action: string; reason: string }>(
          `select id, action, reason from public.product_moderation_history where seller_offer_id = $1`,
          [offerId]
        )
      );
      expect(history.rows.length).toBeGreaterThanOrEqual(1);
      expect(history.rows[0]?.action).toBe('removed_prohibited');

      // History table is append-only (UPDATE and DELETE blocked even for DB owner / Super Admin)
      expect(
        await expectFail(
          as(db, 'service', (tx: Tx) =>
            tx.query(`delete from public.product_moderation_history where id = $1`, [history.rows[0]!.id])
          )
        )
      ).toMatch(/append-only/i);

      // Seller cannot insert moderation history directly
      expect(
        await expectFail(
          as(db, sellerOwnerId, (tx: Tx) =>
            tx.query(
              `insert into public.product_moderation_history (entity_type, product_id, action)
               values ('product', $1, 'approved')`,
              [productId]
            )
          )
        )
      ).toMatch(/row-level security/i);
    });

    it('enforces server-side pack stock validation & out-of-stock updates (admin/super_admin only)', async () => {
      // Retailer and seller cannot call admin_set_product_pack_stock
      expect(
        await expectFail(
          as(db, retailer1Id, (tx: Tx) =>
            tx.query(`select public.admin_set_product_pack_stock($1, 25)`, [packId])
          )
        )
      ).toMatch(/admin|permission|not authorized|Only/i);

      expect(
        await expectFail(
          as(db, sellerOwnerId, (tx: Tx) =>
            tx.query(`select public.admin_set_product_pack_stock($1, 25)`, [packId])
          )
        )
      ).toMatch(/admin|permission|not authorized|Only/i);

      // Negative stock is rejected server-side
      expect(
        await expectFail(
          as(db, superAdminId, (tx: Tx) =>
            tx.query(`select public.admin_set_product_pack_stock($1, -5)`, [packId])
          )
        )
      ).toMatch(/negative|check|invalid|0/i);

      // Super Admin sets stock to 40, then marks out-of-stock (0)
      const stocked = await as(db, superAdminId, (tx: Tx) =>
        tx.query<{ q: number }>(`select public.admin_set_product_pack_stock($1, 40) as q`, [packId])
      );
      expect(Number(stocked.rows[0]?.q)).toBe(40);

      const zeroed = await as(db, superAdminId, (tx: Tx) =>
        tx.query<{ q: number }>(`select public.admin_set_product_pack_stock($1, 0) as q`, [packId])
      );
      expect(Number(zeroed.rows[0]?.q)).toBe(0);
    });
  });

  describe('3. Wholesale pricing limits & server-side seller bypass prevention', () => {
    it('blocks non-Super Admin from changing wholesale rules and enforces global, seller, and pack limits', async () => {
      // Admin & seller cannot modify wholesale rules
      expect(
        await expectFail(
          as(db, adminId, (tx: Tx) =>
            tx.query(`update public.wholesale_pricing_rules set max_discount_percent = 50 where id = 1`)
          ).then((res) => {
            if ((res.affectedRows ?? 0) === 0) throw new Error('row-level security blocked admin');
          })
        )
      ).toMatch(/row-level security|Super Admin/i);

      // Super Admin sets global max discount = 15%, default MOQ = 5
      await as(db, superAdminId, (tx: Tx) =>
        tx.query(
          `update public.wholesale_pricing_rules
              set default_min_order_qty = 5,
                  max_discount_percent = 15.00,
                  allow_seller_custom_slabs = true
            where id = 1`
        )
      );

      // Seller cap above global cap (15%) must be rejected
      expect(
        await expectFail(
          as(db, superAdminId, (tx: Tx) =>
            tx.query(
              `insert into public.seller_pricing_permissions (seller_id, max_discount_percent)
               values ($1, 20.00)`,
              [sellerId]
            )
          )
        )
      ).toMatch(/DISCOUNT_EXCEEDS_GLOBAL_LIMIT/);

      // Offer below MOQ (5) must be blocked by DB trigger
      expect(
        await expectFail(
          as(db, 'service', (tx: Tx) =>
            tx.query(
              `update public.seller_offers set moq = 2 where id = $1`,
              [offerId]
            )
          )
        )
      ).toMatch(/MOQ_BELOW_SUPER_ADMIN_MINIMUM/);

      // Offer exceeding 15% discount below ₹100 (e.g. ₹70 = 30% discount) must be blocked
      expect(
        await expectFail(
          as(db, 'service', (tx: Tx) =>
            tx.query(
              `update public.seller_offers set moq = 5, unit_price_paise = 7000 where id = $1`,
              [offerId]
            )
          )
        )
      ).toMatch(/DISCOUNT_EXCEEDS_MAX_LIMIT/);

      // Valid offer within limits (moq = 5, ₹90 = 10% discount) succeeds
      await as(db, 'service', (tx: Tx) =>
        tx.query(
          `update public.seller_offers set moq = 5, unit_price_paise = 9000 where id = $1`,
          [offerId]
        )
      );

      // Super Admin disables custom slabs for this seller
      await as(db, superAdminId, (tx: Tx) =>
        tx.query(
          `insert into public.seller_pricing_permissions (
             seller_id, can_set_custom_slabs, can_apply_discounts, max_discount_percent
           ) values ($1, false, true, 10.00)
           on conflict (seller_id) do update
             set can_set_custom_slabs = false, max_discount_percent = 10.00`,
          [sellerId]
        )
      );

      // Attempting to add a seller slab while disabled -> BLOCKED
      expect(
        await expectFail(
          as(db, 'service', (tx: Tx) =>
            tx.query(
              `insert into public.seller_offer_tiers (seller_offer_id, min_quantity, unit_price_paise)
               values ($1, 10, 8800)`,
              [offerId]
            )
          )
        )
      ).toMatch(/SELLER_CUSTOM_SLABS_NOT_ALLOWED/);

      // Re-enable slabs with 10% cap -> slab with 20% discount off offer (₹72) is BLOCKED
      await as(db, superAdminId, (tx: Tx) =>
        tx.query(
          `update public.seller_pricing_permissions set can_set_custom_slabs = true, max_discount_percent = 10.00 where seller_id = $1`,
          [sellerId]
        )
      );

      expect(
        await expectFail(
          as(db, 'service', (tx: Tx) =>
            tx.query(
              `insert into public.seller_offer_tiers (seller_offer_id, min_quantity, unit_price_paise)
               values ($1, 10, 7200)`,
              [offerId]
            )
          )
        )
      ).toMatch(/DISCOUNT_EXCEEDS_MAX_LIMIT/);

      // Restore defaults for clean state
      await as(db, superAdminId, (tx: Tx) =>
        tx.query(`update public.wholesale_pricing_rules set default_min_order_qty = 1, max_discount_percent = 25.00 where id = 1`)
      );
    });
  });

  describe('4. Retailer membership governance & immediate expiry enforcement', () => {
    it('keeps plans inactive, blocks live payment collection, and stops benefits immediately on expiry', async () => {
      // Live payment collection cannot be enabled even by service role
      expect(
        await expectFail(
          as(db, 'service', (tx: Tx) =>
            tx.query(`update public.membership_program_settings set live_payment_collection_enabled = true where id = 1`)
          )
        )
      ).toMatch(/check constraint/i);

      // Activating a plan while program_enabled = false is blocked
      expect(
        await expectFail(
          as(db, superAdminId, (tx: Tx) =>
            tx.query(`update public.membership_plans set is_active = true where id = 'silver'`)
          )
        )
      ).toMatch(/MEMBERSHIP_PROGRAM_DISABLED/);

      // Assigning membership while program_enabled = false is blocked
      expect(
        await expectFail(
          as(db, superAdminId, (tx: Tx) =>
            tx.query(`select public.super_admin_assign_membership($1, 'silver', 'test', null)`, [retailer1Id])
          )
        )
      ).toMatch(/MEMBERSHIP_PROGRAM_DISABLED/);

      // Non-Super Admin cannot call super_admin_assign_membership
      expect(
        await expectFail(
          as(db, adminId, (tx: Tx) =>
            tx.query(`select public.super_admin_assign_membership($1, 'silver', 'test', null)`, [retailer1Id])
          )
        )
      ).toMatch(/Super Admin authorization required/i);

      // Configure Silver planned discounts (stays inactive)
      await as(db, superAdminId, (tx: Tx) =>
        tx.query(
          `update public.membership_plans
              set product_discount_percent = 3.00,
                  order_value_discount_percent = 5.00
            where id = 'silver'`
        )
      );

      // Insert a historical Silver record whose expires_at is 5 seconds in the past (status still 'active')
      await as(db, 'service', (tx: Tx) =>
        tx.query(
          `insert into public.retailer_memberships (
             retailer_id, plan_id, tier, status, starts_at, expires_at, notes
           ) values (
             $1, 'silver', 'silver', 'active', now() - interval '365 days', now() - interval '5 seconds', 'Expired test record'
           )`,
          [retailer1Id]
        )
      );

      // Authoritative overview RPC MUST report immediate stop of benefits!
      const overviewRes = await as(db, retailer1Id, (tx: Tx) =>
        tx.query<{ overview: Record<string, unknown> }>(
          `select public.get_retailer_membership_overview($1) as overview`,
          [retailer1Id]
        )
      );
      const overview = overviewRes.rows[0]!.overview as {
        program_enabled: boolean;
        live_payment_collection_enabled: boolean;
        current: {
          is_expired: boolean;
          benefits_active: boolean;
          effective_product_discount_percent: number;
          effective_order_discount_percent: number;
          remaining_seconds: number;
          tier: string;
        };
      };
      expect(overview.program_enabled).toBe(false);
      expect(overview.live_payment_collection_enabled).toBe(false);
      expect(overview.current.is_expired).toBe(true);
      expect(overview.current.benefits_active).toBe(false);
      expect(overview.current.effective_product_discount_percent).toBe(0);
      expect(overview.current.effective_order_discount_percent).toBe(0);
      expect(overview.current.remaining_seconds).toBe(0);
      expect(overview.current.tier).toBe('free');

      // Cross-tenant isolation: retailer2 cannot read retailer1's overview
      expect(
        await expectFail(
          as(db, retailer2Id, (tx: Tx) =>
            tx.query(`select public.get_retailer_membership_overview($1)`, [retailer1Id])
          )
        )
      ).toMatch(/Access denied/i);

      // Retailer cannot submit upgrade request while program_enabled = false
      expect(
        await expectFail(
          as(db, retailer1Id, (tx: Tx) =>
            tx.query(
              `insert into public.membership_upgrade_requests (retailer_id, requested_plan_id)
               values ($1, 'gold')`,
              [retailer1Id]
            )
          )
        )
      ).toMatch(/MEMBERSHIP_PROGRAM_DISABLED/);
    });
  });

  describe('5. Paid seller ad campaigns, anti-self-approval, & banner audit', () => {
    let campaignId: string;

    it('blocks seller self-approval, blocks approval while ads disabled, logs immutable campaign audit, and audits banners', async () => {
      // Live payment collection on ad_program_settings cannot be enabled
      expect(
        await expectFail(
          as(db, 'service', (tx: Tx) =>
            tx.query(`update public.ad_program_settings set live_payment_collection_enabled = true where id = 1`)
          )
        )
      ).toMatch(/check constraint/i);

      // Seller cannot submit an already-approved campaign
      expect(
        await expectFail(
          as(db, sellerOwnerId, (tx: Tx) =>
            tx.query(
              `insert into public.seller_ad_campaigns (
                 seller_id, title, artwork_url, placement, starts_at, ends_at,
                 approval_status, is_active
               ) values (
                 $1, 'Sneaky Approved Ad', 'https://cdn.example.com/ad.png', 'homepage_strip',
                 now() + interval '1 day', now() + interval '10 days', 'approved', true
               )`,
              [sellerId]
            )
          )
        )
      ).toMatch(/unapproved draft\/pending/i);

      // Seller submits valid pending_approval campaign
      const created = await as(db, sellerOwnerId, (tx: Tx) =>
        tx.query<{ id: string }>(
          `insert into public.seller_ad_campaigns (
             seller_id, title, headline, artwork_url, destination_url,
             placement, starts_at, ends_at, budget_paise
           ) values (
             $1, 'Festive Offer Ad', 'Up to 10% wholesale', 'https://cdn.example.com/festive.png',
             '/retailer/catalog', 'homepage_strip', now() + interval '1 day', now() + interval '15 days', 500000
           ) returning id`,
          [sellerId]
        )
      );
      campaignId = created.rows[0]!.id;

      // Seller cannot self-approve or mark payment verified
      expect(
        await expectFail(
          as(db, sellerOwnerId, (tx: Tx) =>
            tx.query(
              `update public.seller_ad_campaigns set approval_status = 'approved', is_active = true where id = $1`,
              [campaignId]
            )
          )
        )
      ).toMatch(/cannot activate|cannot self-approve/i);

      expect(
        await expectFail(
          as(db, sellerOwnerId, (tx: Tx) =>
            tx.query(
              `update public.seller_ad_campaigns set payment_status = 'verified_offline' where id = $1`,
              [campaignId]
            )
          )
        )
      ).toMatch(/Only a Super Admin can update campaign review or payment/i);

      // Other seller cannot see or touch this campaign
      const otherRead = await as(db, otherSellerOwnerId, (tx: Tx) =>
        tx.query(`select id from public.seller_ad_campaigns where id = $1`, [campaignId])
      );
      expect(otherRead.rows).toHaveLength(0);

      // Super Admin cannot approve while seller_ads_enabled = false
      expect(
        await expectFail(
          as(db, superAdminId, (tx: Tx) =>
            tx.query(
              `update public.seller_ad_campaigns set approval_status = 'approved', is_active = true where id = $1`,
              [campaignId]
            )
          )
        )
      ).toMatch(/SELLER_ADS_DISABLED/);

      // Super Admin can reject with reason, logging immutable audit row
      await as(db, superAdminId, (tx: Tx) =>
        tx.query(
          `update public.seller_ad_campaigns
              set approval_status = 'rejected', rejection_reason = 'Artwork missing brand authorization'
            where id = $1`,
          [campaignId]
        )
      );

      const auditRows = await as(db, superAdminId, (tx: Tx) =>
        tx.query<{ id: string; action: string }>(
          `select id, action from public.seller_ad_campaign_audit where campaign_id = $1 order by created_at asc`,
          [campaignId]
        )
      );
      expect(auditRows.rows.map((r) => r.action)).toEqual(['submitted', 'rejected']);

      // Campaign audit is append-only
      expect(
        await expectFail(
          as(db, 'service', (tx: Tx) =>
            tx.query(`delete from public.seller_ad_campaign_audit where id = $1`, [auditRows.rows[0]!.id])
          )
        )
      ).toMatch(/append-only/i);

      // Banner writes are audited into audit_logs
      await as(db, superAdminId, (tx: Tx) =>
        tx.query(
          `insert into public.banners (title, image_url, status, is_active, sort_order)
           values ('Phase3 Audited Banner', 'https://cdn.example.com/banner.png', 'draft', false, 1)`
        )
      );
      const bannerAudit = await as(db, superAdminId, (tx: Tx) =>
        tx.query<{ table_name: string }>(
          `select table_name from public.audit_logs where table_name = 'banners' limit 1`
        )
      );
      expect(bannerAudit.rows).toHaveLength(1);
    });
  });

  describe('6. Anon access denial, role escalation prevention, & super_admin_audit_logs integrity', () => {
    it('denies anonymous reads across all Phase 3 governance tables', async () => {
      const sensitiveTables = [
        'wholesale_pricing_rules',
        'seller_pricing_permissions',
        'product_wholesale_limits',
        'product_moderation_history',
        'membership_program_settings',
        'membership_upgrade_requests',
        'ad_program_settings',
        'seller_ad_campaigns',
        'seller_ad_campaign_audit',
        'super_admin_audit_logs',
      ];
      for (const tbl of sensitiveTables) {
        expect(
          await expectFail(
            as(db, 'anon', (tx: Tx) => tx.query(`select * from public.${tbl} limit 1`))
          )
        ).toMatch(/permission denied/i);
      }
    });

    it('blocks role self-escalation and enforces append-only, actor-pinned super_admin_audit_logs', async () => {
      // Retailer and seller cannot escalate their own role
      expect(
        await expectFail(
          as(db, retailer1Id, (tx: Tx) =>
            tx.query(`update public.profiles set role = 'super_admin' where id = $1`, [retailer1Id])
          )
        )
      ).toMatch(/role|permission|row-level security/i);

      expect(
        await expectFail(
          as(db, sellerOwnerId, (tx: Tx) =>
            tx.query(`update public.profiles set role = 'admin' where id = $1`, [sellerOwnerId])
          )
        )
      ).toMatch(/role|permission|row-level security/i);

      // Super Admin cannot forge actor_id on super_admin_audit_logs
      expect(
        await expectFail(
          as(db, superAdminId, (tx: Tx) =>
            tx.query(
              `insert into public.super_admin_audit_logs (actor_id, action, reason)
               values ($1, 'FORGED_ACTION', 'Attempted attribution spoofing')`,
              [adminId]
            )
          )
        )
      ).toMatch(/actor_id must match/i);

      // Legitimate Super Admin audit insert succeeds, then UPDATE/DELETE are blocked forever
      const inserted = await as(db, superAdminId, (tx: Tx) =>
        tx.query<{ id: string }>(
          `insert into public.super_admin_audit_logs (actor_id, action, reason)
           values ($1, 'PHASE3_VERIFIED', 'Audit immutability check') returning id`,
          [superAdminId]
        )
      );
      const auditId = inserted.rows[0]!.id;

      expect(
        await expectFail(
          as(db, 'service', (tx: Tx) =>
            tx.query(`update public.super_admin_audit_logs set reason = 'tampered' where id = $1`, [auditId])
          )
        )
      ).toMatch(/append-only/i);

      expect(
        await expectFail(
          as(db, 'service', (tx: Tx) =>
            tx.query(`delete from public.super_admin_audit_logs where id = $1`, [auditId])
          )
        )
      ).toMatch(/append-only/i);
    });
  });

  describe('7. Migration 0109 idempotency & guarded rollback', () => {
    it('replays 0109 idempotently, guards rollback against silent data loss, and rolls back cleanly when authorized', async () => {
      const upSql = readFileSync('supabase/migrations/0109_phase3_business_control.sql', 'utf8');
      const downSql = readFileSync('supabase/rollbacks/0109_phase3_business_control.down.sql', 'utf8');

      // Replaying UP must be completely idempotent
      await db.exec(upSql);

      // Rollback WITHOUT allow_data_loss must refuse because moderation/ad records exist
      expect(await expectFail(db.exec(downSql))).toMatch(/Refusing to drop non-empty Phase 3 records/i);

      // Rollback WITH allow_data_loss succeeds cleanly and re-applying UP restores everything cleanly
      await db.exec(`begin; set local maharani.allow_data_loss = 'true'; ${downSql} commit;`);
      await db.exec(upSql);

      const { rows } = await db.query<{ c: string }>(
        `select count(*)::text as c from public.wholesale_pricing_rules`
      );
      expect(rows[0]!.c).toBe('1');
    });
  });
});
