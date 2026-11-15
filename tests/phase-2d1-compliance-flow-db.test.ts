import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { acceptSellerAgreementAs, as, createMigratedDb, createUser, errorOf, openMarketplaceForTest, type Db, type Tx } from './helpers/pg-harness';

let db: Db;
let superAdminId: string;
let productId: string;
let packId: string;
let sellerId: string;
let offerId: string;

const sellerEvidenceTypes = [
  'business_identity', 'business_address', 'business_contact', 'seller_agreement',
  'settlement_verification', 'compliance_declaration', 'product_source_evidence',
] as const;

function objectId(): string {
  return randomUUID();
}

async function asSuper<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return as(db, superAdminId, fn);
}

async function seedApprovedProductAndSeller(): Promise<void> {
  const suffix = randomUUID().slice(0, 8);
  const { rows: categories } = await db.query<{ id: string }>(
    `insert into categories (name, is_active) values ($1, true) returning id`,
    [`Household care test category ${suffix}`]
  );
  const categoryId = categories[0]!.id;
  await asSuper((tx) => tx.query(
    `update categories set compliance_scope = 'fmcg', compliance_scope_reason = 'Owner-reviewed non-food test category'
      where id = $1`, [categoryId]
  ));

  const { rows: products } = await db.query<{ id: string }>(
    `insert into products (sku_code, name, unit, base_price, gst_percent, category_id, is_active)
     values ($1, $2, 'pcs', 100, 18, $3, false) returning id`,
    [`P2D1-${suffix}`, `Non-food product ${suffix}`, categoryId]
  );
  productId = products[0]!.id;
  const { rows: packs } = await db.query<{ id: string }>(
    `insert into product_packs (product_id, pack_name, pack_sku_code, units_per_case, base_price, case_price, mrp, is_active)
     values ($1, '1 unit', $2, 1, 100, 100, 120, true) returning id`,
    [productId, `P2D1-PACK-${suffix}`]
  );
  packId = packs[0]!.id;
  await asSuper((tx) => tx.query(
    `update products
        set regulatory_classification = 'non_food_fmcg',
            regulatory_classification_reason = 'Owner-reviewed non-food FMCG classification'
      where id = $1`, [productId]
  ));

  await asSuper((tx) => tx.query(
    `insert into product_compliance_evidence
       (product_id, seller_id, evidence_type, storage_bucket_id, storage_object_key, file_name, content_type, uploaded_by)
     values ($1, null, 'label_photo', 'compliance-evidence', $2, 'label.png', 'image/png', $3)`,
    [productId, `products/${productId}/central/label_photo/${objectId()}.png`, superAdminId]
  ));
  const { rows: productReviews } = await asSuper((tx) => tx.query<{ id: string }>(
    `insert into product_compliance_reviews
       (product_id, category_scope, review_status, applicability, applicability_reason,
        mrp, selling_price, net_quantity, uqc, pack_size, manufacturer_or_importer, consumer_care_details, created_by)
     values ($1, 'fmcg', 'submitted', '{"country_of_origin_required":false}'::jsonb,
        'Reviewer recorded the country-of-origin applicability decision.',
        120, 100, '1 piece', 'pcs', '1 piece', 'Test manufacturer', 'Test consumer care', $2)
     returning id`, [productId, superAdminId]
  ));
  await asSuper((tx) => tx.query(
    `update product_compliance_reviews set review_status = 'approved' where id = $1`,
    [productReviews[0]!.id]
  ));
  await asSuper((tx) => tx.query(`update products set is_active = true where id = $1`, [productId]));

  const { rows: sellers } = await db.query<{ id: string }>(
    `insert into sellers (business_name, contact_name, phone, email, address_line, status, created_by)
     values ($1, 'Compliance Contact', '9876543210', $2, 'Test address', 'pending', $3) returning id`,
    [`P2D1 Seller ${suffix}`, `seller-${suffix}@test.local`, superAdminId]
  );
  sellerId = sellers[0]!.id;
  for (const evidenceType of sellerEvidenceTypes) {
    await asSuper((tx) => tx.query(
      `insert into seller_compliance_evidence
         (seller_id, evidence_type, storage_bucket_id, storage_object_key, file_name, content_type, uploaded_by)
       values ($1, $2, 'compliance-evidence', $3, 'evidence.pdf', 'application/pdf', $4)`,
      [sellerId, evidenceType, `sellers/${sellerId}/${evidenceType}/${objectId()}.pdf`, superAdminId]
    ));
  }
  const { rows: sellerReviews } = await asSuper((tx) => tx.query<{ id: string }>(
    `insert into seller_compliance_reviews
       (seller_id, review_status, business_identity_verified, business_address_verified,
        business_contact_verified, product_source_evidence_verified, settlement_verified,
        seller_agreement_version, seller_agreement_accepted_at,
        compliance_declaration_version, compliance_declaration_accepted_at, created_by)
     values ($1, 'submitted', true, true, true, true, true, 'test-v1', now(), 'test-v1', now(), $2)
     returning id`, [sellerId, superAdminId]
  ));
  await asSuper((tx) => tx.query(
    `update seller_compliance_reviews set review_status = 'approved' where id = $1`,
    [sellerReviews[0]!.id]
  ));
  await asSuper((tx) => tx.query(`update sellers set status = 'active' where id = $1`, [sellerId]));

  // 0098: an offer can be published only once the marketplace is open and the
  // seller's owner has accepted the current Seller Agreement.
  const sellerOwner = await createUser(db, 'seller', 'Phase 2D.1 Seller Owner');
  await asSuper((tx) => tx.query(
    `insert into seller_members (seller_id, profile_id, member_role) values ($1, $2, 'owner')`, [sellerId, sellerOwner]));
  await acceptSellerAgreementAs(db, sellerOwner);
  await openMarketplaceForTest(db);

  const { rows: offers } = await asSuper((tx) => tx.query<{ id: string }>(
    `insert into seller_offers
       (seller_id, product_id, pack_id, fulfilment_type, unit_price_paise, moq, stock_quantity,
        is_active, moderation_status, moderation_by, moderated_at, created_by)
     values ($1, $2, $3, 'seller', 10000, 1, 50, true, 'approved', $4, now(), $4)
     returning id`, [sellerId, productId, packId, superAdminId]
  ));
  offerId = offers[0]!.id;
}

beforeAll(async () => {
  db = await createMigratedDb();
  superAdminId = await createUser(db, 'super_admin', 'Phase 2D.1 Super Admin');
  await seedApprovedProductAndSeller();
}, 180_000);

afterAll(async () => {
  await db?.close();
});

describe('0087 Phase 2D.1 database enforcement', () => {
  it('permits pending -> reviewed -> active seller activation, but refuses an active seller INSERT without a current review', async () => {
    const directActiveSeller = await errorOf(db, superAdminId, (tx) => tx.query(
      `insert into sellers (business_name, status, created_by) values ($1, 'active', $2)`,
      [`Unreviewed seller ${randomUUID()}`, superAdminId]
    ));
    expect(directActiveSeller).toMatch(/SELLER_COMPLIANCE_REQUIRED/);
    const { rows } = await db.query<{ status: string }>(`select status from sellers where id = $1`, [sellerId]);
    expect(rows).toEqual([{ status: 'active' }]);
  });

  it('suspends a seller with an active offer and atomically drains that offer', async () => {
    await asSuper((tx) => tx.query(
      `update sellers set status = 'suspended', suspension_reason = 'Controlled compliance test suspension' where id = $1`,
      [sellerId]
    ));
    const { rows } = await db.query<{ status: string; is_active: boolean }>(
      `select s.status, so.is_active from sellers s join seller_offers so on so.seller_id = s.id where s.id = $1`,
      [sellerId]
    );
    expect(rows).toEqual([{ status: 'suspended', is_active: false }]);
  });

  it('refuses re-publication for a suspended seller but permits offer deactivation after product ineligibility', async () => {
    const suspendedActivation = await errorOf(db, superAdminId, (tx) => tx.query(
      `update seller_offers set is_active = true, moderation_status = 'approved' where id = $1`, [offerId]
    ));
    expect(suspendedActivation).toMatch(/SELLER_COMPLIANCE_REQUIRED|SELLER_NOT_ACTIVE/);

    await asSuper((tx) => tx.query(`update products set is_active = false where id = $1`, [productId]));
    await asSuper((tx) => tx.query(`update seller_offers set is_active = false where id = $1`, [offerId]));
  });

  it('invalidates old approvals for inactive product, pack, and suspended-seller fact changes', async () => {
    const { rows: beforeProduct } = await db.query<{ compliance_revision: string }>(
      `select compliance_revision from products where id = $1`, [productId]
    );
    await asSuper((tx) => tx.query(`update products set name = name || ' revised' where id = $1`, [productId]));
    await asSuper((tx) => tx.query(`update product_packs set pack_name = 'revised pack' where id = $1`, [packId]));
    const productEligible = await asSuper((tx) => tx.query<{ eligible: boolean }>(
      `select public.product_is_sale_eligible($1) as eligible`, [productId]
    ));
    expect(productEligible.rows).toEqual([{ eligible: false }]);
    const { rows: afterProduct } = await db.query<{ compliance_revision: string }>(
      `select compliance_revision from products where id = $1`, [productId]
    );
    expect(Number(afterProduct[0]!.compliance_revision)).toBeGreaterThan(Number(beforeProduct[0]!.compliance_revision));

    await asSuper((tx) => tx.query(`update sellers set business_name = business_name || ' revised' where id = $1`, [sellerId]));
    const sellerEligible = await asSuper((tx) => tx.query<{ eligible: boolean }>(
      `select public.seller_is_trade_eligible($1) as eligible`, [sellerId]
    ));
    expect(sellerEligible.rows).toEqual([{ eligible: false }]);
    const reinstate = await errorOf(db, superAdminId, (tx) => tx.query(
      `update sellers set status = 'active' where id = $1`, [sellerId]
    ));
    expect(reinstate).toMatch(/SELLER_COMPLIANCE_REQUIRED/);

    const { rows: invalidations } = await db.query<{ action: string }>(
      `select action from product_compliance_review_audit where product_id = $1 and action = 'invalidated'`, [productId]
    );
    expect(invalidations.length).toBeGreaterThan(0);
  });

  it('fails closed for food_blocked and unclassified product classifications', async () => {
    const { rows: classRows } = await db.query<{ regulatory_classification: string }>(
      `select regulatory_classification from products where id = $1`, [productId]
    );
    expect(classRows[0]!.regulatory_classification).toBe('non_food_fmcg');
    await asSuper((tx) => tx.query(
      `update products set regulatory_classification = 'food_blocked', regulatory_classification_reason = 'Explicit food exclusion test' where id = $1`,
      [productId]
    ));
    const foodEligible = await asSuper((tx) => tx.query<{ eligible: boolean }>(
      `select public.product_is_sale_eligible($1) as eligible`, [productId]
    ));
    expect(foodEligible.rows).toEqual([{ eligible: false }]);
    await asSuper((tx) => tx.query(
      `update products set regulatory_classification = 'unclassified', regulatory_classification_reason = null where id = $1`,
      [productId]
    ));
    const unknownEligible = await asSuper((tx) => tx.query<{ eligible: boolean }>(
      `select public.product_is_sale_eligible($1) as eligible`, [productId]
    ));
    expect(unknownEligible.rows).toEqual([{ eligible: false }]);
  });

  it('denies anonymous and cross-seller reads of private evidence objects while permitting the authorized Super Admin reviewer', async () => {
    const sellerOneUser = await createUser(db, 'seller', 'Evidence seller one');
    const sellerTwoUser = await createUser(db, 'seller', 'Evidence seller two');
    const sellerOne = randomUUID();
    const sellerTwo = randomUUID();
    await db.query(
      `insert into sellers (id, business_name, status, created_by) values
       ($1, $2, 'pending', $3), ($4, $5, 'pending', $3)`,
      [sellerOne, `Evidence seller one ${sellerOne}`, superAdminId, sellerTwo, `Evidence seller two ${sellerTwo}`]
    );
    await db.query(
      `insert into seller_members (seller_id, profile_id, member_role, created_by) values
       ($1, $2, 'owner', $3), ($4, $5, 'owner', $3)`,
      [sellerOne, sellerOneUser, superAdminId, sellerTwo, sellerTwoUser]
    );
    const privateKey = `sellers/${sellerTwo}/business_identity/${objectId()}.pdf`;
    await asSuper((tx) => tx.query(
      `insert into seller_compliance_evidence
       (seller_id, evidence_type, storage_bucket_id, storage_object_key, file_name, content_type, uploaded_by)
       values ($1, 'business_identity', 'compliance-evidence', $2, 'identity.pdf', 'application/pdf', $3)`,
      [sellerTwo, privateKey, superAdminId]
    ));
    await db.query(
      `insert into storage.objects (bucket_id, name) values ('compliance-evidence', $1)`, [privateKey]
    );

    const anonObjects = await as(db, 'anon', (tx) => tx.query<{ name: string }>(
      `select name from storage.objects where bucket_id = 'compliance-evidence' and name = $1`, [privateKey]
    ));
    const crossSellerObjects = await as(db, sellerOneUser, (tx) => tx.query<{ name: string }>(
      `select name from storage.objects where bucket_id = 'compliance-evidence' and name = $1`, [privateKey]
    ));
    const reviewerObjects = await asSuper((tx) => tx.query<{ name: string }>(
      `select name from storage.objects where bucket_id = 'compliance-evidence' and name = $1`, [privateKey]
    ));
    expect(anonObjects.rows).toHaveLength(0);
    expect(crossSellerObjects.rows).toHaveLength(0);
    expect(reviewerObjects.rows).toEqual([{ name: privateKey }]);
  });
});
