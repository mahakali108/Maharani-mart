-- ============================================================================
-- 0087: Phase 2D.1 — compliance trigger correction, revision invalidation,
--       least-privilege function ACLs, and private evidence storage.
--
-- FOR AUTHORIZED DISPOSABLE-STAGING REVIEW ONLY. This forward migration does
-- not classify, approve, activate, delete, or rewrite existing business data.
-- Existing approved reviews intentionally do not receive a fabricated revision
-- stamp: they fail closed until an authorized reviewer records a current review.
-- Do not apply to a remote project without an owner-approved rollout, backup,
-- PostgreSQL ACL/RLS verification, and the storage configuration review below.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Explicit product regulation classification and durable review revisions.
-- ---------------------------------------------------------------------------
-- Category scope remains an owner decision, but it is no longer sufficient to
-- sell a product. Every product needs its own reviewed classification. Existing
-- rows remain `unclassified`; this deliberately does not infer a classification
-- from a name, description, category, or previous review.
alter table public.products
  add column if not exists regulatory_classification text not null default 'unclassified',
  add column if not exists regulatory_classification_reason text,
  add column if not exists regulatory_classification_reviewed_by uuid references public.profiles(id),
  add column if not exists regulatory_classification_reviewed_at timestamptz,
  add column if not exists compliance_revision bigint not null default 1;

alter table public.products
  drop constraint if exists products_regulatory_classification_check;
alter table public.products
  add constraint products_regulatory_classification_check
  check (regulatory_classification in ('cosmetics', 'non_food_fmcg', 'food_blocked', 'unclassified'));

alter table public.products
  drop constraint if exists products_regulatory_classification_reason_check;
alter table public.products
  add constraint products_regulatory_classification_reason_check
  check (regulatory_classification_reason is null
    or char_length(btrim(regulatory_classification_reason)) between 3 and 1000);

alter table public.products
  drop constraint if exists products_compliance_revision_check;
alter table public.products
  add constraint products_compliance_revision_check check (compliance_revision >= 1);

alter table public.sellers
  add column if not exists compliance_revision bigint not null default 1;
alter table public.sellers
  drop constraint if exists sellers_compliance_revision_check;
alter table public.sellers
  add constraint sellers_compliance_revision_check check (compliance_revision >= 1);

alter table public.product_compliance_reviews
  add column if not exists approved_product_revision bigint,
  add column if not exists approved_review_fingerprint text;
alter table public.product_compliance_reviews
  drop constraint if exists product_compliance_reviews_approved_revision_check;
alter table public.product_compliance_reviews
  add constraint product_compliance_reviews_approved_revision_check
  check (approved_product_revision is null or approved_product_revision >= 1);
alter table public.product_compliance_reviews
  drop constraint if exists product_compliance_reviews_approved_fingerprint_check;
alter table public.product_compliance_reviews
  add constraint product_compliance_reviews_approved_fingerprint_check
  check (approved_review_fingerprint is null or approved_review_fingerprint ~ '^[a-f0-9]{32}$');

alter table public.seller_compliance_reviews
  add column if not exists approved_seller_revision bigint,
  add column if not exists approved_review_fingerprint text;
alter table public.seller_compliance_reviews
  drop constraint if exists seller_compliance_reviews_approved_revision_check;
alter table public.seller_compliance_reviews
  add constraint seller_compliance_reviews_approved_revision_check
  check (approved_seller_revision is null or approved_seller_revision >= 1);
alter table public.seller_compliance_reviews
  drop constraint if exists seller_compliance_reviews_approved_fingerprint_check;
alter table public.seller_compliance_reviews
  add constraint seller_compliance_reviews_approved_fingerprint_check
  check (approved_review_fingerprint is null or approved_review_fingerprint ~ '^[a-f0-9]{32}$');

-- Review audit rows retain previous review data. These two audit tables also
-- record a revision invalidation even when the old review is not rewritten.
alter table public.product_compliance_review_audit
  drop constraint if exists product_compliance_review_audit_action_check;
alter table public.product_compliance_review_audit
  add constraint product_compliance_review_audit_action_check
  check (action in ('created', 'pending', 'submitted', 'approved', 'rejected', 'correction_required', 'expired', 'updated', 'invalidated'));
alter table public.seller_compliance_review_audit
  drop constraint if exists seller_compliance_review_audit_action_check;
alter table public.seller_compliance_review_audit
  add constraint seller_compliance_review_audit_action_check
  check (action in ('created', 'pending', 'submitted', 'approved', 'rejected', 'correction_required', 'expired', 'updated', 'invalidated'));

create or replace function public.enforce_product_regulatory_classification()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_is_super_admin boolean := public.is_authenticated_super_admin();
begin
  if tg_op = 'INSERT' then
    -- Product creators can draft only. They cannot turn a product into a
    -- Cosmetics/non-food FMCG product by crafting an API payload.
    if new.regulatory_classification <> 'unclassified' and not v_is_super_admin then
      raise exception 'Only a Super Admin can classify a product for regulatory sale scope.' using errcode = '42501';
    end if;
  elsif new.regulatory_classification is distinct from old.regulatory_classification
     or new.regulatory_classification_reason is distinct from old.regulatory_classification_reason then
    if not v_is_super_admin then
      raise exception 'Only a Super Admin can change product regulatory classification.' using errcode = '42501';
    end if;
  end if;

  if new.regulatory_classification in ('cosmetics', 'non_food_fmcg', 'food_blocked') then
    if new.regulatory_classification_reason is null
       or char_length(btrim(new.regulatory_classification_reason)) < 3 then
      raise exception 'An owner-recorded regulatory classification reason is required for every classified product.' using errcode = '22023';
    end if;
    -- A pack/category revision touch must never overwrite the actual owner who
    -- classified the product. This also keeps an explicit audit actor/time for
    -- a food_blocked decision without making that product saleable.
    if tg_op = 'INSERT'
       or new.regulatory_classification is distinct from old.regulatory_classification
       or new.regulatory_classification_reason is distinct from old.regulatory_classification_reason then
      new.regulatory_classification_reviewed_by := auth.uid();
      new.regulatory_classification_reviewed_at := clock_timestamp();
    end if;
  elsif new.regulatory_classification = 'unclassified'
     and (tg_op = 'INSERT'
          or new.regulatory_classification is distinct from old.regulatory_classification
          or new.regulatory_classification_reason is distinct from old.regulatory_classification_reason) then
    -- Unknown is not an owner approval and always fails closed.
    new.regulatory_classification_reviewed_by := null;
    new.regulatory_classification_reviewed_at := null;
  end if;
  return new;
end;
$$;

create or replace function public.bump_product_compliance_revision()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_relevant_change boolean;
begin
  if tg_op <> 'UPDATE' then
    return new;
  end if;

  v_relevant_change := new.name is distinct from old.name
    or new.brand_id is distinct from old.brand_id
    or new.category_id is distinct from old.category_id
    or new.unit is distinct from old.unit
    or new.units_per_case is distinct from old.units_per_case
    or new.base_price is distinct from old.base_price
    or new.gst_percent is distinct from old.gst_percent
    or new.hsn_code is distinct from old.hsn_code
    or new.barcode is distinct from old.barcode
    or new.regulatory_classification is distinct from old.regulatory_classification
    or new.regulatory_classification_reason is distinct from old.regulatory_classification_reason;

  if v_relevant_change then
    new.compliance_revision := old.compliance_revision + 1;
  elsif new.compliance_revision is distinct from old.compliance_revision
     and new.compliance_revision <> old.compliance_revision + 1 then
    -- Only a database trigger may perform the harmless +1 invalidation touch.
    -- Callers can never forge a future revision or restore an old approval.
    raise exception 'Product compliance revision may only advance by one through a compliance invalidation trigger.' using errcode = '42501';
  end if;
  return new;
end;
$$;

create or replace function public.bump_seller_compliance_revision()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.business_name is distinct from old.business_name
     or new.pan is distinct from old.pan
     or new.gstin is distinct from old.gstin
     or new.contact_name is distinct from old.contact_name
     or new.phone is distinct from old.phone
     or new.email is distinct from old.email
     or new.address_line is distinct from old.address_line then
    new.compliance_revision := old.compliance_revision + 1;
  elsif new.compliance_revision is distinct from old.compliance_revision
     and new.compliance_revision <> old.compliance_revision + 1 then
    raise exception 'Seller compliance revision may only advance by one through a compliance invalidation trigger.' using errcode = '42501';
  end if;
  return new;
end;
$$;

-- This fingerprint captures review facts that are not represented on the
-- product row (manufacturer/origin, batch/expiry and declarations). The
-- product revision separately covers catalogue/product-pack facts.
create or replace function public.product_compliance_review_fingerprint(
  p_review public.product_compliance_reviews
) returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select md5(concat_ws('|',
    coalesce(p_review.category_scope, ''),
    coalesce(p_review.applicability::text, ''),
    coalesce(p_review.applicability_reason, ''),
    coalesce(p_review.manufacturer_or_importer, ''),
    coalesce(p_review.country_of_origin, ''),
    coalesce(p_review.batch_identifier, ''),
    coalesce(p_review.expiry_date::text, ''),
    coalesce(p_review.net_contents, ''),
    coalesce(p_review.ingredients, ''),
    coalesce(p_review.warnings, ''),
    coalesce(p_review.manufacturing_licence_reference, ''),
    coalesce(p_review.import_registration_reference, ''),
    coalesce(p_review.supplier_invoice_reference, ''),
    coalesce(p_review.mrp::text, ''),
    coalesce(p_review.selling_price::text, ''),
    coalesce(p_review.net_quantity, ''),
    coalesce(p_review.uqc, ''),
    coalesce(p_review.pack_size, ''),
    coalesce(p_review.consumer_care_details, ''),
    coalesce(p_review.evidence_reference, '')
  ));
$$;

-- The seller record is deliberately part of the fingerprint; a review cannot
-- be reused after legal identity, contact/address, or GST facts change.
create or replace function public.seller_compliance_review_fingerprint(
  p_review public.seller_compliance_reviews
) returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select md5(concat_ws('|',
    coalesce(s.business_name, ''), coalesce(s.pan, ''), coalesce(s.gstin, ''),
    coalesce(s.contact_name, ''), coalesce(s.phone, ''),
    coalesce(s.email, ''), coalesce(s.address_line, ''),
    p_review.business_identity_verified::text,
    p_review.business_address_verified::text,
    p_review.business_contact_verified::text,
    p_review.gst_applicable::text,
    p_review.gstin_verified::text,
    coalesce(p_review.seller_agreement_version, ''),
    coalesce(to_char(p_review.seller_agreement_accepted_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'), ''),
    p_review.product_source_evidence_verified::text,
    p_review.cosmetics_authorization_required::text,
    p_review.cosmetics_authorization_verified::text,
    p_review.settlement_verified::text,
    coalesce(p_review.compliance_declaration_version, ''),
    coalesce(to_char(p_review.compliance_declaration_accepted_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'), ''),
    coalesce(p_review.evidence_reference, '')
  ))
  from public.sellers s
  where s.id = p_review.seller_id;
$$;

create or replace function public.stamp_product_compliance_approval_revision()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.review_status = 'approved'
     and (tg_op = 'INSERT' or old.review_status is distinct from 'approved') then
    -- Serialize approval stamping with product/category/pack revision writers.
    -- A later fact change waits, then records its invalidation audit against this
    -- approved revision instead of racing an un-audited stale approval.
    select p.compliance_revision into new.approved_product_revision
    from public.products p where p.id = new.product_id for share;
    if new.approved_product_revision is null then
      raise exception 'Product compliance approval requires an existing product revision.' using errcode = '23503';
    end if;
    new.approved_review_fingerprint := public.product_compliance_review_fingerprint(new);
  elsif new.review_status is distinct from 'approved' then
    new.approved_product_revision := null;
    new.approved_review_fingerprint := null;
  end if;
  return new;
end;
$$;

create or replace function public.stamp_seller_compliance_approval_revision()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.review_status = 'approved'
     and (tg_op = 'INSERT' or old.review_status is distinct from 'approved') then
    -- Serialize approval stamping with verified seller-fact writers for a
    -- deterministic revision/audit order.
    select s.compliance_revision into new.approved_seller_revision
    from public.sellers s where s.id = new.seller_id for share;
    if new.approved_seller_revision is null then
      raise exception 'Seller compliance approval requires an existing seller revision.' using errcode = '23503';
    end if;
    new.approved_review_fingerprint := public.seller_compliance_review_fingerprint(new);
    if new.approved_review_fingerprint is null then
      raise exception 'Seller compliance approval requires current seller facts.' using errcode = '23503';
    end if;
  elsif new.review_status is distinct from 'approved' then
    new.approved_seller_revision := null;
    new.approved_review_fingerprint := null;
  end if;
  return new;
end;
$$;

-- Effective eligibility is now coupled to the current product/seller revision
-- and fingerprint. Old approvals remain immutable audit history but authorize
-- nothing after a relevant fact changes.
create or replace function public.product_has_sale_eligible_compliance(p_product_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.products p
    join public.categories c on c.id = p.category_id
    join public.product_compliance_reviews r on r.product_id = p.id
    where p.id = p_product_id
      and c.is_active
      and (
        (c.compliance_scope = 'cosmetics' and p.regulatory_classification = 'cosmetics')
        or (c.compliance_scope = 'fmcg' and p.regulatory_classification = 'non_food_fmcg')
      )
      and p.regulatory_classification_reviewed_by is not null
      and p.regulatory_classification_reviewed_at is not null
      and r.category_scope = c.compliance_scope
      and r.review_status = 'approved'
      and r.approved_product_revision = p.compliance_revision
      and r.approved_review_fingerprint = public.product_compliance_review_fingerprint(r)
      and (r.expires_at is null or r.expires_at > clock_timestamp())
  );
$$;

create or replace function public.seller_has_trade_eligible_compliance(p_seller_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.sellers s
    join public.seller_compliance_reviews r on r.seller_id = s.id
    where s.id = p_seller_id
      and r.review_status = 'approved'
      and r.approved_seller_revision = s.compliance_revision
      and r.approved_review_fingerprint = public.seller_compliance_review_fingerprint(r)
      and (r.expires_at is null or r.expires_at > clock_timestamp())
  );
$$;

create or replace function public.audit_product_compliance_revision_invalidation()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.compliance_revision is distinct from old.compliance_revision then
    insert into public.product_compliance_review_audit (
      product_compliance_review_id, product_id, actor_id, action, before_data, after_data
    )
    select r.id, new.id, auth.uid(), 'invalidated',
           jsonb_build_object('approvedProductRevision', r.approved_product_revision),
           jsonb_build_object('currentProductRevision', new.compliance_revision,
                              'reason', 'sale-relevant product, pack, category, or product classification facts changed')
      from public.product_compliance_reviews r
     where r.product_id = new.id and r.review_status = 'approved';
  end if;
  return new;
end;
$$;

create or replace function public.audit_seller_compliance_revision_invalidation()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.compliance_revision is distinct from old.compliance_revision then
    insert into public.seller_compliance_review_audit (
      seller_compliance_review_id, seller_id, actor_id, action, before_data, after_data
    )
    select r.id, new.id, auth.uid(), 'invalidated',
           jsonb_build_object('approvedSellerRevision', r.approved_seller_revision),
           jsonb_build_object('currentSellerRevision', new.compliance_revision,
                              'reason', 'verified seller identity, contact, address, or GST facts changed')
      from public.seller_compliance_reviews r
     where r.seller_id = new.id and r.review_status = 'approved';
  end if;
  return new;
end;
$$;

create or replace function public.bump_product_revision_from_pack_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_product_id uuid;
begin
  if tg_op = 'DELETE' then
    v_product_id := old.product_id;
  else
    v_product_id := new.product_id;
  end if;

  if tg_op = 'INSERT'
     or tg_op = 'DELETE'
     or new.product_id is distinct from old.product_id
     or new.pack_name is distinct from old.pack_name
     or new.pack_sku_code is distinct from old.pack_sku_code
     or new.units_per_case is distinct from old.units_per_case
     or new.base_price is distinct from old.base_price
     or new.mrp is distinct from old.mrp
     or new.ptr is distinct from old.ptr
     or new.wholesale_price is distinct from old.wholesale_price
     or new.case_price is distinct from old.case_price
     or new.barcode is distinct from old.barcode
     or new.allow_loose_pieces is distinct from old.allow_loose_pieces
     or new.image_url is distinct from old.image_url
     or new.is_active is distinct from old.is_active then
    update public.products
       set compliance_revision = compliance_revision + 1
     where id = v_product_id;
    if tg_op = 'UPDATE' and new.product_id is distinct from old.product_id then
      update public.products
         set compliance_revision = compliance_revision + 1
       where id = old.product_id;
    end if;
  end if;
  return coalesce(new, old);
end;
$$;

create or replace function public.bump_product_revision_from_category_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.compliance_scope is distinct from old.compliance_scope
     or new.name is distinct from old.name
     or new.parent_id is distinct from old.parent_id then
    update public.products
       set compliance_revision = compliance_revision + 1
     where category_id = new.id;
  end if;
  return new;
end;
$$;

create or replace function public.bump_product_revision_from_brand_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.name is distinct from old.name then
    update public.products
       set compliance_revision = compliance_revision + 1
     where brand_id = new.id;
  end if;
  return new;
end;
$$;

-- Trigger names use the 0087 prefix so revision stamping runs before prior
-- compliance guards, while audit triggers run after the change is committed
-- within the same statement transaction.
drop trigger if exists trg_0087_enforce_product_regulatory_classification on public.products;
create trigger trg_0087_enforce_product_regulatory_classification
before insert or update on public.products
for each row execute function public.enforce_product_regulatory_classification();
drop trigger if exists trg_0087_bump_product_compliance_revision on public.products;
create trigger trg_0087_bump_product_compliance_revision
before update on public.products
for each row execute function public.bump_product_compliance_revision();
drop trigger if exists trg_0087_bump_seller_compliance_revision on public.sellers;
create trigger trg_0087_bump_seller_compliance_revision
before update on public.sellers
for each row execute function public.bump_seller_compliance_revision();
drop trigger if exists trg_0087_stamp_product_compliance_approval_revision on public.product_compliance_reviews;
create trigger trg_0087_stamp_product_compliance_approval_revision
before insert or update on public.product_compliance_reviews
for each row execute function public.stamp_product_compliance_approval_revision();
drop trigger if exists trg_0087_stamp_seller_compliance_approval_revision on public.seller_compliance_reviews;
create trigger trg_0087_stamp_seller_compliance_approval_revision
before insert or update on public.seller_compliance_reviews
for each row execute function public.stamp_seller_compliance_approval_revision();
drop trigger if exists trg_0087_audit_product_compliance_revision_invalidation on public.products;
create trigger trg_0087_audit_product_compliance_revision_invalidation
after update on public.products
for each row execute function public.audit_product_compliance_revision_invalidation();
drop trigger if exists trg_0087_audit_seller_compliance_revision_invalidation on public.sellers;
create trigger trg_0087_audit_seller_compliance_revision_invalidation
after update on public.sellers
for each row execute function public.audit_seller_compliance_revision_invalidation();
drop trigger if exists trg_0087_bump_product_revision_from_pack_change on public.product_packs;
create trigger trg_0087_bump_product_revision_from_pack_change
after insert or update or delete on public.product_packs
for each row execute function public.bump_product_revision_from_pack_change();
drop trigger if exists trg_0087_bump_product_revision_from_category_change on public.categories;
create trigger trg_0087_bump_product_revision_from_category_change
after update on public.categories
for each row execute function public.bump_product_revision_from_category_change();
drop trigger if exists trg_0087_bump_product_revision_from_brand_change on public.brands;
create trigger trg_0087_bump_product_revision_from_brand_change
after update on public.brands
for each row execute function public.bump_product_revision_from_brand_change();

-- ---------------------------------------------------------------------------
-- 2. Correct offer enforcement: require eligibility before a listing can trade,
--    never prevent a safety-reducing withdrawal, rejection, or suspension.
-- ---------------------------------------------------------------------------
create or replace function public.enforce_seller_offer_compliance()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_requires_eligibility boolean := tg_op = 'INSERT';
  v_locked_product uuid;
  v_locked_seller uuid;
begin
  if tg_op = 'UPDATE' then
    -- Existing listings may always be made less available. Checks occur only
    -- when an offer becomes retailer-saleable or its sale identity changes.
    v_requires_eligibility := new.is_active and new.moderation_status = 'approved'
      and (
        not (old.is_active and old.moderation_status = 'approved')
        or new.product_id is distinct from old.product_id
        or new.seller_id is distinct from old.seller_id
        or new.pack_id is distinct from old.pack_id
      );
  end if;

  if not v_requires_eligibility then
    return new;
  end if;

  -- Lock the current product and seller before evaluating eligibility. A seller
  -- suspension takes a conflicting row lock, so an offer publication cannot
  -- race a drain-mode suspension and reappear unintentionally on reinstatement.
  select p.id into v_locked_product
    from public.products p where p.id = new.product_id for share;
  if v_locked_product is null then
    raise exception 'PRODUCT_COMPLIANCE_REQUIRED: offer product does not exist.' using errcode = '23503';
  end if;
  select s.id into v_locked_seller
    from public.sellers s where s.id = new.seller_id for share;
  if v_locked_seller is null then
    raise exception 'SELLER_COMPLIANCE_REQUIRED: offer seller does not exist.' using errcode = '23503';
  end if;

  if not public.product_is_sale_eligible(new.product_id) then
    raise exception 'PRODUCT_COMPLIANCE_REQUIRED: an offer cannot use an unapproved, expired, stale-review, food, or out-of-scope product.' using errcode = '23514';
  end if;
  if not public.seller_is_trade_eligible(new.seller_id) then
    raise exception 'SELLER_COMPLIANCE_REQUIRED: an unverified, stale-review, suspended, or expired seller cannot create or publish an offer.' using errcode = '23514';
  end if;
  return new;
end;
$$;

-- The prior Phase 2D trigger was UPDATE-only. Inserts with status=active must
-- now fail closed too. A valid review is normally created while the seller is
-- pending and then permits the explicit activation transition.
create or replace function public.enforce_seller_compliance_activation()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.status = 'active'
     and (tg_op = 'INSERT' or new.status is distinct from old.status)
     and not public.seller_has_trade_eligible_compliance(new.id) then
    raise exception 'SELLER_COMPLIANCE_REQUIRED: seller activation requires an approved, current-revision, unexpired compliance review.' using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_compliance_seller_activation on public.sellers;
create trigger trg_compliance_seller_activation
before insert or update on public.sellers
for each row execute function public.enforce_seller_compliance_activation();

-- ---------------------------------------------------------------------------
-- 3. Dedicated private Storage bucket and object/evidence binding.
-- ---------------------------------------------------------------------------
-- The 10 MiB and image/PDF allowlist match the repository's existing private
-- document buckets (0006/0059). Any production change to this bucket name,
-- size, or MIME allowlist requires an owner-approved migration; this migration
-- fails loudly rather than relaxing a pre-existing bucket configuration.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'compliance-evidence', 'compliance-evidence', false, 10485760,
  array['image/png', 'image/jpeg', 'image/webp', 'application/pdf']
)
on conflict (id) do nothing;

do $$
declare
  v_bucket storage.buckets%rowtype;
begin
  select * into v_bucket from storage.buckets where id = 'compliance-evidence';
  if not found or v_bucket.public is distinct from false
     or v_bucket.file_size_limit is distinct from 10485760
     or v_bucket.allowed_mime_types is distinct from array['image/png', 'image/jpeg', 'image/webp', 'application/pdf']::text[] then
    raise exception 'The compliance-evidence bucket must remain private with the reviewed 10 MiB image/PDF allowlist; review bucket configuration before applying 0087.';
  end if;
end;
$$;

alter table public.product_compliance_evidence
  add column if not exists storage_bucket_id text;
alter table public.seller_compliance_evidence
  add column if not exists storage_bucket_id text;
alter table public.product_compliance_evidence
  drop constraint if exists product_compliance_evidence_storage_bucket_check;
alter table public.product_compliance_evidence
  add constraint product_compliance_evidence_storage_bucket_check
  check (storage_bucket_id is null or storage_bucket_id = 'compliance-evidence');
alter table public.seller_compliance_evidence
  drop constraint if exists seller_compliance_evidence_storage_bucket_check;
alter table public.seller_compliance_evidence
  add constraint seller_compliance_evidence_storage_bucket_check
  check (storage_bucket_id is null or storage_bucket_id = 'compliance-evidence');

create or replace function public.compliance_evidence_content_type_matches_key(
  p_storage_object_key text,
  p_content_type text
) returns boolean
language sql
immutable
set search_path = public, pg_temp
as $$
  select (p_content_type = 'application/pdf' and p_storage_object_key ~ '\.pdf$')
      or (p_content_type = 'image/png' and p_storage_object_key ~ '\.png$')
      or (p_content_type = 'image/webp' and p_storage_object_key ~ '\.webp$')
      or (p_content_type = 'image/jpeg' and p_storage_object_key ~ '\.(jpg|jpeg)$');
$$;

create or replace function public.enforce_product_compliance_evidence_storage_binding()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_pattern text;
begin
  -- Preserve legacy rows exactly as found. Any new evidence row must use the
  -- dedicated private bucket and an opaque, canonical key with no user filename.
  if tg_op = 'UPDATE' and old.storage_bucket_id is null and new.storage_bucket_id is null then
    return new;
  end if;
  if new.storage_bucket_id is distinct from 'compliance-evidence'
     or new.content_type not in ('image/png', 'image/jpeg', 'image/webp', 'application/pdf')
     or new.file_name is null
     or not public.compliance_evidence_content_type_matches_key(new.storage_object_key, new.content_type) then
    raise exception 'Compliance evidence must use the private compliance-evidence bucket and an allowed MIME/key extension.' using errcode = '23514';
  end if;

  if new.seller_id is null then
    v_pattern := '^products/' || new.product_id::text || '/central/' || new.evidence_type
      || '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(png|jpg|jpeg|webp|pdf)$';
  else
    v_pattern := '^products/' || new.product_id::text || '/sellers/' || new.seller_id::text || '/' || new.evidence_type
      || '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(png|jpg|jpeg|webp|pdf)$';
  end if;
  if new.storage_object_key !~ v_pattern then
    raise exception 'Product evidence object key is not canonical for its product, seller, and evidence type.' using errcode = '23514';
  end if;
  return new;
end;
$$;

create or replace function public.enforce_seller_compliance_evidence_storage_binding()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_pattern text;
begin
  if tg_op = 'UPDATE' and old.storage_bucket_id is null and new.storage_bucket_id is null then
    return new;
  end if;
  if new.storage_bucket_id is distinct from 'compliance-evidence'
     or new.content_type not in ('image/png', 'image/jpeg', 'image/webp', 'application/pdf')
     or new.file_name is null
     or not public.compliance_evidence_content_type_matches_key(new.storage_object_key, new.content_type) then
    raise exception 'Compliance evidence must use the private compliance-evidence bucket and an allowed MIME/key extension.' using errcode = '23514';
  end if;
  v_pattern := '^sellers/' || new.seller_id::text || '/' || new.evidence_type
    || '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(png|jpg|jpeg|webp|pdf)$';
  if new.storage_object_key !~ v_pattern then
    raise exception 'Seller evidence object key is not canonical for its seller and evidence type.' using errcode = '23514';
  end if;
  return new;
end;
$$;

create or replace function public.can_write_compliance_evidence_object(p_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_match text[];
begin
  if public.is_authenticated_super_admin() then
    return p_name ~ '^(products/[0-9a-f-]+/central|products/[0-9a-f-]+/sellers/[0-9a-f-]+|sellers/[0-9a-f-]+)/(label_photo|supplier_invoice|source_authorization|manufacturing_licence|import_registration|country_of_origin|product_source_evidence|business_identity|business_address|business_contact|gst_registration|seller_agreement|settlement_verification|compliance_declaration|cosmetics_authorization)/[0-9a-f-]+\.(png|jpg|jpeg|webp|pdf)$';
  end if;

  v_match := regexp_match(p_name, '^products/([0-9a-f-]+)/sellers/([0-9a-f-]+)/[^/]+/[0-9a-f-]+\.(png|jpg|jpeg|webp|pdf)$');
  if v_match is not null then
    return public.is_member_of_seller(v_match[2]::uuid)
      and exists (
        select 1 from public.seller_offers so
        where so.seller_id = v_match[2]::uuid and so.product_id = v_match[1]::uuid
      );
  end if;
  v_match := regexp_match(p_name, '^sellers/([0-9a-f-]+)/[^/]+/[0-9a-f-]+\.(png|jpg|jpeg|webp|pdf)$');
  if v_match is not null then
    return public.is_member_of_seller(v_match[1]::uuid);
  end if;
  return false;
end;
$$;

create or replace function public.can_read_compliance_evidence_object(p_name text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.is_authenticated_super_admin()
      or exists (
        select 1
        from public.product_compliance_evidence e
        where e.storage_bucket_id = 'compliance-evidence'
          and e.storage_object_key = p_name
          and e.seller_id is not null
          and public.is_member_of_seller(e.seller_id)
      )
      or exists (
        select 1
        from public.seller_compliance_evidence e
        where e.storage_bucket_id = 'compliance-evidence'
          and e.storage_object_key = p_name
          and public.is_member_of_seller(e.seller_id)
      );
$$;

drop trigger if exists trg_0087_enforce_product_compliance_evidence_storage_binding on public.product_compliance_evidence;
create trigger trg_0087_enforce_product_compliance_evidence_storage_binding
before insert or update on public.product_compliance_evidence
for each row execute function public.enforce_product_compliance_evidence_storage_binding();
drop trigger if exists trg_0087_enforce_seller_compliance_evidence_storage_binding on public.seller_compliance_evidence;
create trigger trg_0087_enforce_seller_compliance_evidence_storage_binding
before insert or update on public.seller_compliance_evidence
for each row execute function public.enforce_seller_compliance_evidence_storage_binding();

-- No delete policy is intentionally created: evidence objects are retained for
-- review/audit. Server-side retention work, if ever authorized, must be a
-- separate owner-approved process rather than a browser capability.
drop policy if exists "compliance_evidence_read" on storage.objects;
create policy "compliance_evidence_read" on storage.objects
for select to authenticated using (
  bucket_id = 'compliance-evidence'
  and public.can_read_compliance_evidence_object(name)
);
drop policy if exists "compliance_evidence_write" on storage.objects;
create policy "compliance_evidence_write" on storage.objects
for insert to authenticated with check (
  bucket_id = 'compliance-evidence'
  and public.can_write_compliance_evidence_object(name)
);
drop policy if exists "compliance_evidence_update" on storage.objects;
-- Explicitly omit an UPDATE policy. Immutable object keys prevent replacement
-- after reviewer evidence registration and keep signed URL targets stable.

-- ---------------------------------------------------------------------------
-- 4. Explicit SECURITY DEFINER execution ACLs for 0085, 0086, and this file.
-- Trigger execution does not require EXECUTE. Internal helpers therefore have
-- no API-role grants; authenticated only receives public RPCs deliberately used
-- by server actions/RLS policy evaluation.
-- ---------------------------------------------------------------------------
revoke all on function public.record_ordering_launch_readiness(jsonb, text)
  from public, anon, authenticated, service_role;
grant execute on function public.record_ordering_launch_readiness(jsonb, text) to authenticated;

revoke all on function public.is_authenticated_super_admin() from public, anon, authenticated, service_role;
grant execute on function public.is_authenticated_super_admin() to authenticated;

revoke all on function public.enforce_category_compliance_scope(),
  public.compliance_boolean(jsonb, text),
  public.product_compliance_has_evidence(uuid, text),
  public.seller_compliance_has_evidence(uuid, text),
  public.assert_product_compliance_approvable(public.product_compliance_reviews),
  public.assert_seller_compliance_approvable(public.seller_compliance_reviews),
  public.product_has_sale_eligible_compliance(uuid),
  public.seller_has_trade_eligible_compliance(uuid),
  public.enforce_product_compliance_review(),
  public.enforce_seller_compliance_review(),
  public.audit_product_compliance_review(),
  public.audit_seller_compliance_review(),
  public.enforce_product_compliance_publication(),
  public.enforce_product_pack_compliance_change(),
  public.enforce_seller_compliance_profile_change(),
  public.enforce_seller_compliance_activation(),
  public.enforce_seller_offer_compliance(),
  public.enforce_order_item_compliance(),
  public.enforce_product_regulatory_classification(),
  public.bump_product_compliance_revision(),
  public.bump_seller_compliance_revision(),
  public.product_compliance_review_fingerprint(public.product_compliance_reviews),
  public.seller_compliance_review_fingerprint(public.seller_compliance_reviews),
  public.stamp_product_compliance_approval_revision(),
  public.stamp_seller_compliance_approval_revision(),
  public.audit_product_compliance_revision_invalidation(),
  public.audit_seller_compliance_revision_invalidation(),
  public.bump_product_revision_from_pack_change(),
  public.bump_product_revision_from_category_change(),
  public.bump_product_revision_from_brand_change(),
  public.compliance_evidence_content_type_matches_key(text, text),
  public.enforce_product_compliance_evidence_storage_binding(),
  public.enforce_seller_compliance_evidence_storage_binding(),
  public.can_write_compliance_evidence_object(text)
from public, anon, authenticated, service_role;

revoke all on function public.product_is_sale_eligible(uuid),
  public.seller_is_trade_eligible(uuid),
  public.get_catalog_compliance_review_report(),
  public.marketplace_offer_quotes(uuid[]),
  public.marketplace_offers_for_product(uuid),
  public.marketplace_offer_tiers(uuid[]),
  public.can_read_compliance_evidence_object(text)
from public, anon, authenticated, service_role;
grant execute on function public.product_is_sale_eligible(uuid),
  public.seller_is_trade_eligible(uuid),
  public.get_catalog_compliance_review_report(),
  public.marketplace_offer_quotes(uuid[]),
  public.marketplace_offers_for_product(uuid),
  public.marketplace_offer_tiers(uuid[]),
  public.can_write_compliance_evidence_object(text),
  public.can_read_compliance_evidence_object(text)
to authenticated;

comment on column public.products.regulatory_classification is
  'Owner-reviewed product-level classification. Only cosmetics and non_food_fmcg aligned with category scope can ever be sale-eligible; existing rows are deliberately unclassified.';
comment on column public.products.compliance_revision is
  'Monotonic revision of sale-relevant product/category/pack facts. An approved review is effective only when it records this exact revision.';
comment on column public.sellers.compliance_revision is
  'Monotonic revision of verified seller business/contact/GST facts. An approved review is effective only when it records this exact revision.';
comment on table public.product_compliance_evidence is
  'Private compliance evidence metadata. New rows must bind to canonical objects in private storage bucket compliance-evidence; legacy rows are retained untouched pending owner review.';
comment on table public.seller_compliance_evidence is
  'Private seller evidence metadata. New rows must bind to canonical objects in private storage bucket compliance-evidence; legacy rows are retained untouched pending owner review.';
