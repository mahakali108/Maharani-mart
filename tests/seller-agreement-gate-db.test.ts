/**
 * Migration 0098 on real PostgreSQL 16 (PGlite): the Seller Agreement gate and
 * the third-party marketplace switch, at the database boundary.
 *
 * Catalogue / seller COMPLIANCE triggers (0086) are tested elsewhere and are
 * switched off on seller_offers and order_items here so that each refusal
 * below can only come from the 0098 gate. Row-level security stays on.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { as, createMigratedDb, createRetailer, createUser, errorOf, type Db, type Tx } from './helpers/pg-harness';
import { legalDocumentByKey } from '@/lib/legal/documents';

let db: Db;
let superAdmin: string;
let admin: string;
let retailer: string;
let product: string;
let pack: string;

interface SellerFixture { seller: string; owner: string; member: string }

async function isolateGate(target: Db) {
  await target.exec(`
    alter table public.seller_offers disable trigger user;
    alter table public.seller_offers enable trigger trg_seller_offer_launch_gate;
    alter table public.order_items disable trigger user;
    alter table public.order_items enable trigger trg_order_item_marketplace_gate;
  `);
}

async function newSeller(): Promise<SellerFixture> {
  const seller = randomUUID();
  const owner = await createUser(db, 'seller', 'Seller Owner');
  const member = await createUser(db, 'seller', 'Seller Staff');
  await db.exec(`set session_replication_role = 'replica'`);
  await db.query(`insert into public.sellers (id, business_name, status) values ($1, $2, 'active')`, [seller, `Seller ${seller}`]);
  await db.query(`insert into public.seller_members (seller_id, profile_id, member_role) values ($1, $2, 'owner'), ($1, $3, 'member')`, [seller, owner, member]);
  await db.exec(`set session_replication_role = 'origin'`);
  return { seller, owner, member };
}

/** A draft offer (inactive, pending) seeded without going through the gate. */
async function draftOffer(seller: string, state: { active?: boolean; moderation?: string } = {}): Promise<string> {
  const id = randomUUID();
  const ownPack = randomUUID(); // one active offer per (seller, pack): give each offer its own pack
  await db.exec(`set session_replication_role = 'replica'`);
  await db.query(`insert into public.product_packs (id, product_id, pack_name, pack_sku_code, base_price, case_price, stock_quantity) values ($1, $2, $3, $4, 10, 10, 7)`, [ownPack, product, `Pack ${ownPack}`, `SKU-${ownPack}`]);
  await db.query(
    `insert into public.seller_offers (id, seller_id, product_id, pack_id, fulfilment_type, unit_price_paise, stock_quantity, is_active, moderation_status)
     values ($1, $2, $3, $4, 'seller', 1000, 5, $5, $6)`,
    [id, seller, product, ownPack, state.active ?? false, state.moderation ?? 'pending']);
  await db.exec(`set session_replication_role = 'origin'`);
  return id;
}
const offerState = async (id: string) => (await db.query<{ is_active: boolean; moderation_status: string; stock_quantity: number }>(
  `select is_active, moderation_status, stock_quantity from public.seller_offers where id = $1`, [id])).rows[0];

const accept = (who: string, version = legalDocumentByKey('seller-agreement')!.version) => errorOf(db, who, (tx: Tx) =>
  tx.query(`select public.record_legal_acceptance('seller-agreement', $1, 'seller_onboarding')`, [version]));
const setSwitch = (who: string, enabled: boolean, ownerRef: string | null = null, caRef: string | null = null) => errorOf(db, who, (tx: Tx) =>
  tx.query(`select public.record_marketplace_launch_approval($1, $2, $3, 'test')`, [enabled, ownerRef, caRef]));
const enabled = async () => (await db.query<{ on: boolean }>(`select public.third_party_offers_enabled() "on"`)).rows[0]!.on;
const open = () => setSwitch(superAdmin, true, 'OWNER-MINUTE-2026-11-20', 'CA-LETTER-2026-11-21');
const close = () => setSwitch(superAdmin, false);
const activate = (who: string, offer: string) => errorOf(db, who, (tx: Tx) => tx.query(`update public.seller_offers set is_active = true where id = $1`, [offer]));
const approve = (who: string, offer: string) => errorOf(db, who, (tx: Tx) => tx.query(`update public.seller_offers set moderation_status = 'approved' where id = $1`, [offer]));
async function orderLine(offer: string): Promise<string | null> {
  const order = randomUUID();
  await db.query(`insert into public.orders (id, order_number, retailer_id, status) values ($1, $2, $3, 'pending')`, [order, `G-${order.slice(0, 13)}`, retailer]);
  try {
    await db.query(
      `insert into public.order_items (order_id, product_id, pack_id, seller_offer_id, source_type, fulfilment_type, quantity, unit_price, line_total)
       values ($1, $2, $3, $4, 'seller', 'seller', 1, 10, 10)`, [order, product, pack, offer]);
    return null;
  } catch (error) { return (error as Error).message; }
}

describe('0098 Seller Agreement gate and marketplace switch (PostgreSQL 16)', () => {
  beforeAll(async () => {
    db = await createMigratedDb();
    superAdmin = await createUser(db, 'super_admin', 'Owner');
    admin = await createUser(db, 'admin', 'Admin');
    retailer = (await createRetailer(db)).id;
    await db.query(`insert into public.warehouses (name, is_active) values ('WH 0098', true)`);
    product = randomUUID(); pack = randomUUID();
    await db.exec(`set session_replication_role = 'replica'`);
    await db.query(`insert into public.products (id, sku_code, name, unit, base_price) values ($1, $2, 'Gate product', 'PCS', 10)`, [product, product]);
    await db.query(`insert into public.product_packs (id, product_id, pack_name, pack_sku_code, base_price, case_price, stock_quantity) values ($1, $2, 'Pack', $3, 10, 10, 7)`, [pack, product, pack]);
    await db.exec(`set session_replication_role = 'origin'`);
    await isolateGate(db);
  }, 120_000);

  describe('the migration ships closed and records no approval', () => {
    it('switch is off, the approval log is empty, and the agreement version matches the published registry', async () => {
      expect(await enabled()).toBe(false);
      expect((await db.query(`select 1 from public.marketplace_launch_approvals`)).rows).toHaveLength(0);
      const { rows } = await db.query<{ document_version: string }>(`select document_version from public.legal_document_current_versions where document_key = 'seller-agreement'`);
      expect(rows[0]?.document_version).toBe(legalDocumentByKey('seller-agreement')!.version);
    });

    it('the migration text contains no tax registration number or tax rate', () => {
      const sql = readFileSync('supabase/migrations/0098_seller_agreement_and_marketplace_gate.sql', 'utf8');
      expect(sql).not.toMatch(/\b\d{2}[A-Z]{5}\d{4}[A-Z]\d[A-Z\d]{2}\b/); // GSTIN shape
      expect(sql).not.toMatch(/\b[A-Z]{4}\d{5}[A-Z]\b/); // TAN shape
      expect(sql).not.toMatch(/\d+(\.\d+)?\s*%/);
      // The only INSERT into the approval log is inside record_marketplace_launch_approval().
      expect(sql.match(/insert into public\.marketplace_launch_approvals/gi)).toHaveLength(1);
    });
  });

  describe('REPRODUCTION: without the gate anyone could publish', () => {
    it('with the 0098 trigger off, an offer goes live with no agreement and no approval', async () => {
      const s = await newSeller();
      const offer = await draftOffer(s.seller);
      await db.exec(`alter table public.seller_offers disable trigger trg_seller_offer_launch_gate`);
      try {
        expect(await activate(s.owner, offer)).toBeNull();
        expect(await approve(admin, offer)).toBeNull();
      } finally {
        await db.exec(`alter table public.seller_offers enable trigger trg_seller_offer_launch_gate`);
      }
      expect(await offerState(offer)).toMatchObject({ is_active: true, moderation_status: 'approved' });
    });
  });

  describe('while the marketplace switch is OFF', () => {
    it('nobody can activate, publish or insert a live offer - seller, Admin, Super Admin or service role', async () => {
      const s = await newSeller();
      expect(await accept(s.owner)).toBeNull(); // even with the agreement accepted
      const offer = await draftOffer(s.seller);
      for (const who of [s.owner, admin, superAdmin, 'service']) {
        expect(await activate(who, offer), `activate as ${who}`).toMatch(/MARKETPLACE_NOT_OPEN/);
        expect(await approve(who, offer), `approve as ${who}`).toMatch(/MARKETPLACE_NOT_OPEN|Only an Admin/);
        expect(await errorOf(db, who, (tx: Tx) => tx.query(
          `insert into public.seller_offers (seller_id, product_id, pack_id, fulfilment_type, unit_price_paise, stock_quantity, is_active, moderation_status)
           values ($1, $2, $3, 'seller', 1000, 5, true, 'pending')`, [s.seller, product, pack])), `insert as ${who}`).toMatch(/MARKETPLACE_NOT_OPEN/);
      }
      expect(await offerState(offer)).toMatchObject({ is_active: false, moderation_status: 'pending' });
    });

    it('an existing live offer cannot be ordered', async () => {
      const s = await newSeller();
      const live = await draftOffer(s.seller, { active: true, moderation: 'approved' });
      expect(await orderLine(live)).toMatch(/MARKETPLACE_NOT_OPEN/);
    });

    it('deactivation, rejection and stock movements are never blocked', async () => {
      const s = await newSeller();
      const live = await draftOffer(s.seller, { active: true, moderation: 'approved' });
      expect(await errorOf(db, 'service', (tx: Tx) => tx.query(`update public.seller_offers set stock_quantity = stock_quantity + 3 where id = $1`, [live]))).toBeNull();
      expect(await errorOf(db, admin, (tx: Tx) => tx.query(`update public.seller_offers set moderation_status = 'rejected' where id = $1`, [live]))).toBeNull();
      expect(await errorOf(db, s.owner, (tx: Tx) => tx.query(`update public.seller_offers set is_active = false where id = $1`, [live]))).toBeNull();
      expect(await offerState(live)).toMatchObject({ is_active: false, moderation_status: 'rejected', stock_quantity: 8 });
    });
  });

  describe('turning the switch on needs a Super Admin AND two separate approval references', () => {
    it('refuses every role except Super Admin', async () => {
      const s = await newSeller();
      for (const who of [admin, retailer, s.owner, 'anon', 'service']) {
        expect(await setSwitch(who, true, 'OWNER-REF-1', 'CA-REF-1'), who).toMatch(/Only an authenticated Super Admin|permission denied/);
      }
      expect(await enabled()).toBe(false);
    });

    it('refuses a missing, placeholder or duplicated reference', async () => {
      for (const [ownerRef, caRef] of [
        [null, 'CA-REF-1'], ['OWNER-REF-1', null], ['', ''], ['OWNER-REF-1', 'TBD'], ['n/a', 'CA-REF-1'],
        ['pending', 'CA-REF-1'], ['OWNER-REF-1', 'ab'], ['SAME-REF-1', 'same-ref-1'],
      ] as [string | null, string | null][]) {
        expect(await setSwitch(superAdmin, true, ownerRef, caRef), `${ownerRef} / ${caRef}`).toMatch(/MARKETPLACE_APPROVAL_REQUIRED/);
      }
      expect(await enabled()).toBe(false);
    });

    it('the table itself refuses an "enabled" row without both references, and API roles cannot write it', async () => {
      await expect(db.query(`insert into public.marketplace_launch_approvals (third_party_offers_enabled, owner_approval_reference, recorded_by) values (true, 'OWNER-REF-1', $1)`, [superAdmin]))
        .rejects.toThrow(/marketplace_launch_approvals_enable_needs_both/);
      for (const who of [superAdmin, admin, 'service', 'anon']) {
        expect(await errorOf(db, who, (tx: Tx) => tx.query(
          `insert into public.marketplace_launch_approvals (third_party_offers_enabled, owner_approval_reference, ca_approval_reference, recorded_by) values (true, 'OWNER-REF-1', 'CA-REF-1', $1)`, [superAdmin])), who)
          .toMatch(/permission denied/);
      }
      expect(await enabled()).toBe(false);
    });

    it('records who approved, keeps history append-only, and can be switched off again', async () => {
      expect(await open()).toBeNull();
      expect(await enabled()).toBe(true);
      const { rows } = await db.query<{ recorded_by: string; owner_approval_reference: string; ca_approval_reference: string }>(
        `select recorded_by, owner_approval_reference, ca_approval_reference from public.marketplace_launch_approvals order by recorded_at desc limit 1`);
      expect(rows[0]).toEqual({ recorded_by: superAdmin, owner_approval_reference: 'OWNER-MINUTE-2026-11-20', ca_approval_reference: 'CA-LETTER-2026-11-21' });
      for (const who of [superAdmin, 'service']) {
        expect(await errorOf(db, who, (tx: Tx) => tx.query(`update public.marketplace_launch_approvals set third_party_offers_enabled = true`))).toMatch(/permission denied/);
        expect(await errorOf(db, who, (tx: Tx) => tx.query(`delete from public.marketplace_launch_approvals`))).toMatch(/permission denied/);
      }
      expect(await close()).toBeNull();
      expect(await enabled()).toBe(false);
      expect((await db.query(`select 1 from public.marketplace_launch_approvals`)).rows).toHaveLength(2);
    });
  });

  describe('with the switch ON, the current Seller Agreement must be accepted by an owner of that seller', () => {
    it('blocks activation and publication until the owner accepts; then both work', async () => {
      await open();
      const s = await newSeller();
      const offer = await draftOffer(s.seller);
      for (const who of [s.owner, admin, superAdmin, 'service']) {
        expect(await activate(who, offer), who).toMatch(/SELLER_AGREEMENT_REQUIRED/);
      }
      expect(await approve(admin, offer)).toMatch(/SELLER_AGREEMENT_REQUIRED/);
      expect(await orderLine(await draftOffer(s.seller, { active: true, moderation: 'approved' }))).toMatch(/SELLER_AGREEMENT_REQUIRED/);

      expect(await accept(s.owner)).toBeNull();
      expect(await activate(s.owner, offer)).toBeNull();
      expect(await approve(admin, offer)).toBeNull();
      expect(await offerState(offer)).toMatchObject({ is_active: true, moderation_status: 'approved' });
      expect(await orderLine(offer)).toBeNull();
      await close();
    });

    it('acceptance by a non-owner member, by another seller, by an Admin or by a retailer does not count', async () => {
      await open();
      const s = await newSeller();
      const other = await newSeller();
      const offer = await draftOffer(s.seller);
      for (const who of [s.member, other.owner, admin, superAdmin, retailer]) expect(await accept(who)).toBeNull();
      expect(await activate(s.owner, offer)).toMatch(/SELLER_AGREEMENT_REQUIRED/);
      expect(await approve(admin, offer)).toMatch(/SELLER_AGREEMENT_REQUIRED/);
      await close();
    });

    it('only the CURRENT version can be accepted (no pre-accepting or stale versions)', async () => {
      const s = await newSeller();
      expect(await accept(s.owner, '0.9')).toMatch(/LEGAL_VERSION_NOT_CURRENT/);
      expect(await accept(s.owner, '9.9')).toMatch(/LEGAL_VERSION_NOT_CURRENT/);
      expect((await db.query(`select 1 from public.legal_document_acceptances where user_id = $1`, [s.owner])).rows).toHaveLength(0);
    });

    it('an acceptance row cannot be forged for someone else or written directly', async () => {
      const s = await newSeller();
      for (const who of [s.member, admin, retailer]) {
        expect(await errorOf(db, who, (tx: Tx) => tx.query(
          `insert into public.legal_document_acceptances (user_id, document_key, document_version, context) values ($1, 'seller-agreement', '1.0', 'seller_onboarding')`, [s.owner])), who)
          .toMatch(/permission denied/);
      }
    });

    it('publishing a new agreement version closes the gate for every seller until they accept it', async () => {
      await open();
      const s = await newSeller();
      expect(await accept(s.owner)).toBeNull();
      const live = await draftOffer(s.seller);
      expect(await activate(s.owner, live)).toBeNull();
      expect(await approve(admin, live)).toBeNull();

      for (const who of [admin, s.owner, retailer, 'anon', 'service']) {
        expect(await errorOf(db, who, (tx: Tx) => tx.query(`select public.publish_legal_document_version('seller-agreement', '2.0')`)), who)
          .toMatch(/Only an authenticated Super Admin|permission denied/);
      }
      expect(await errorOf(db, superAdmin, (tx: Tx) => tx.query(`select public.publish_legal_document_version('seller-agreement', '2.0')`))).toBeNull();
      try {
        const next = await draftOffer(s.seller);
        expect(await activate(s.owner, next)).toMatch(/SELLER_AGREEMENT_REQUIRED/);
        expect(await orderLine(live)).toMatch(/SELLER_AGREEMENT_REQUIRED/); // the live offer stops selling too
        expect(await accept(s.owner, '1.0')).toMatch(/LEGAL_VERSION_NOT_CURRENT/);
        expect(await accept(s.owner, '2.0')).toBeNull();
        expect(await activate(s.owner, next)).toBeNull();
        expect(await orderLine(live)).toBeNull();
      } finally {
        await db.query(`update public.legal_document_current_versions set document_version = $1 where document_key = 'seller-agreement'`, [legalDocumentByKey('seller-agreement')!.version]);
        await close();
      }
    });

    it('fails closed when no current version is registered', async () => {
      await open();
      const s = await newSeller();
      expect(await accept(s.owner)).toBeNull();
      const offer = await draftOffer(s.seller);
      await db.query(`delete from public.legal_document_current_versions where document_key = 'seller-agreement'`);
      try {
        expect(await activate(s.owner, offer)).toMatch(/SELLER_AGREEMENT_REQUIRED/);
      } finally {
        await db.query(`insert into public.legal_document_current_versions (document_key, document_version) values ('seller-agreement', $1)`, [legalDocumentByKey('seller-agreement')!.version]);
        await close();
      }
    });
  });

  describe('gate read model', () => {
    it('a seller sees only their own seller; retailer and anonymous callers are refused', async () => {
      const s = await newSeller();
      const other = await newSeller();
      const read = (who: string, seller: string) => as(db, who, async (tx: Tx) =>
        (await tx.query<{ r: Record<string, unknown> }>(`select public.seller_offer_gate_status($1) r`, [seller])).rows[0]!.r);
      expect(await read(s.owner, s.seller)).toEqual({ marketplace_open: false, agreement_current: false, agreement_version: legalDocumentByKey('seller-agreement')!.version });
      expect(await read(admin, s.seller)).toMatchObject({ marketplace_open: false });
      expect(await read('service', s.seller)).toMatchObject({ marketplace_open: false });
      for (const who of [other.owner, retailer, 'anon']) {
        expect(await errorOf(db, who, (tx: Tx) => tx.query(`select public.seller_offer_gate_status($1)`, [s.seller])), who).toMatch(/Access denied|permission denied/);
      }
      for (const who of [s.owner, retailer, 'anon']) {
        expect(await errorOf(db, who, (tx: Tx) => tx.query(`select public.seller_agreement_is_current($1)`, [s.seller])), who).toMatch(/permission denied/);
      }
    });
  });
});

describe('0098 rollback script', () => {
  it('applies cleanly, keeps the approval log as an archive, restores 0095 acceptance, and can be re-applied', async () => {
    const fresh = await createMigratedDb();
    const owner = await createUser(fresh, 'super_admin', 'Owner');
    await as(fresh, owner, (tx: Tx) => tx.query(`select public.record_marketplace_launch_approval(true, 'OWNER-REF-9', 'CA-REF-9', 'evidence')`));
    await fresh.exec(readFileSync('supabase/rollbacks/0098_seller_agreement_and_marketplace_gate.down.sql', 'utf8'));
    const { rows: gone } = await fresh.query(
      `select proname from pg_proc where proname in ('third_party_offers_enabled','seller_agreement_is_current','seller_offer_gate_status','record_marketplace_launch_approval','publish_legal_document_version','enforce_seller_offer_launch_gate','enforce_order_item_marketplace_gate')`);
    expect(gone).toHaveLength(0);
    expect((await fresh.query(`select 1 from pg_trigger where tgname in ('trg_seller_offer_launch_gate','trg_order_item_marketplace_gate')`)).rows).toHaveLength(0);
    const { rows: archive } = await fresh.query<{ owner_approval_reference: string }>(`select owner_approval_reference from public.marketplace_launch_approvals_rollback_archive`);
    expect(archive).toEqual([{ owner_approval_reference: 'OWNER-REF-9' }]);
    // 0095 behaviour is back: any well-formed version is recorded.
    expect(await errorOf(fresh, owner, (tx: Tx) => tx.query(`select public.record_legal_acceptance('seller-agreement', '0.9', 'account')`))).toBeNull();
    await fresh.exec(readFileSync('supabase/migrations/0098_seller_agreement_and_marketplace_gate.sql', 'utf8'));
    expect((await fresh.query<{ on: boolean }>(`select public.third_party_offers_enabled() "on"`)).rows[0]!.on).toBe(false); // re-applied CLOSED

    // Final-completion review: a SECOND rollback after the re-apply must not
    // lose the decisions recorded in between, nor the published version.
    await as(fresh, owner, (tx: Tx) => tx.query(`select public.publish_legal_document_version('seller-agreement', '1.1')`));
    await as(fresh, owner, (tx: Tx) => tx.query(`select public.record_marketplace_launch_approval(true, 'OWNER-REF-10', 'CA-REF-10', 'second evidence')`));
    const down = readFileSync('supabase/rollbacks/0098_seller_agreement_and_marketplace_gate.down.sql', 'utf8');
    expect(down).not.toMatch(/truncate|delete from|drop column/i);
    await fresh.exec(down);
    const { rows: both } = await fresh.query<{ owner_approval_reference: string }>(
      `select owner_approval_reference from public.marketplace_launch_approvals_rollback_archive order by recorded_at`);
    expect(both.map((r) => r.owner_approval_reference)).toEqual(['OWNER-REF-9', 'OWNER-REF-10']);
    const { rows: versions } = await fresh.query<{ document_version: string }>(
      `select document_version from public.legal_document_current_versions_rollback_archive order by archived_at, document_version`);
    expect(versions.map((r) => r.document_version)).toEqual(['1.0', '1.1']);
    // The archives are not reachable from any API session.
    for (const table of ['marketplace_launch_approvals_rollback_archive', 'legal_document_current_versions_rollback_archive']) {
      expect(await errorOf(fresh, owner, (tx: Tx) => tx.query(`select 1 from public.${table}`))).toMatch(/permission denied/);
    }
    await fresh.exec(readFileSync('supabase/migrations/0098_seller_agreement_and_marketplace_gate.sql', 'utf8'));
    expect((await fresh.query<{ on: boolean }>(`select public.third_party_offers_enabled() "on"`)).rows[0]!.on).toBe(false);
    await fresh.close();
  }, 120_000);
});

describe('0096 rollback script', () => {
  it('applies cleanly, restores the 0094 trigger and shortfall body, and can be re-applied', async () => {
    const fresh = await createMigratedDb();
    await fresh.exec(readFileSync('supabase/rollbacks/0096_delivery_snapshot_integrity.down.sql', 'utf8'));
    const triggers = async () => (await fresh.query<{ tgname: string }>(
      `select tgname from pg_trigger where tgname in ('trg_guard_order_delivery_item_snapshot','trg_guard_order_delivery_completion_lines','trg_guard_order_delivery_items_after_completion') order by 1`)).rows.map((r) => r.tgname);
    expect(await triggers()).toEqual(['trg_guard_order_delivery_items_after_completion']);
    const { rows } = await fresh.query<{ src: string }>(`select prosrc src from pg_proc where proname = 'delivery_shortfall_paise'`);
    expect(rows[0]!.src).toContain('/ di.quantity_ordered');
    await fresh.exec(readFileSync('supabase/migrations/0096_delivery_snapshot_integrity.sql', 'utf8'));
    expect(await triggers()).toEqual(['trg_guard_order_delivery_completion_lines', 'trg_guard_order_delivery_item_snapshot']);
    await fresh.close();
  }, 120_000);

  it('all review-only rollbacks apply in reverse order (0099 -> 0094) on one database', async () => {
    const fresh = await createMigratedDb();
    for (const file of [
      '0099_atomic_delivery_completion',
      '0098_seller_agreement_and_marketplace_gate', '0097_atomic_split_order_cancellation', '0096_delivery_snapshot_integrity',
      '0095_legal_acceptance_and_privacy_requests', '0094_delivery_trust_and_loyalty_integrity',
    ]) {
      await fresh.exec(readFileSync(`supabase/rollbacks/${file}.down.sql`, 'utf8'));
    }
    const { rows } = await fresh.query(`select 1 from pg_proc where proname in ('is_untrusted_api_caller','record_legal_acceptance','close_sub_order_atomic','third_party_offers_enabled','guard_order_delivery_item_snapshot','complete_delivery_atomic','_order_loyalty_points_due')`);
    expect(rows).toHaveLength(0);
    await fresh.close();
  }, 120_000);
});
