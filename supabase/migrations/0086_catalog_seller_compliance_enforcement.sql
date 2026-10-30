-- ============================================================================
-- 0086: Cosmetics/FMCG catalogue and marketplace-seller compliance enforcement
--
-- LOCAL REVIEW ONLY. Do not execute this migration against a remote project
-- until data owners, counsel and the release owner have reviewed its rollout.
--
-- Design principles
--   * The only sale scopes are `cosmetics` and `fmcg`. `food_blocked` and
--     `unapproved` are never retail-visible or sale-eligible.
--   * Existing categories are deliberately initialized as `unapproved`, never
--     silently classified as compliant. The review view at the bottom of this
--     migration identifies all records requiring an owner decision.
--   * Uploading evidence is distinct from approving it. Only a real profile
--     row with the `super_admin` role can approve a product or seller record.
--   * Evidence references are private opaque storage keys, not public URLs.
--   * Existing order rows are untouched. The final order-item insert boundary
--     protects new orders without changing fulfilment of historical/pending rows.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Authoritative category scope. Product/category names alone are not a
-- legal classification, so a Super Admin must record the scope decision.
-- ---------------------------------------------------------------------------
alter table public.categories
  add column if not exists compliance_scope text not null default 'unapproved',
  add column if not exists compliance_scope_reason text,
  add column if not exists compliance_scope_reviewed_by uuid references public.profiles(id),
  add column if not exists compliance_scope_reviewed_at timestamptz;

alter table public.categories
  drop constraint if exists categories_compliance_scope_check;
alter table public.categories
  add constraint categories_compliance_scope_check
  check (compliance_scope in ('cosmetics', 'fmcg', 'food_blocked', 'unapproved'));

alter table public.categories
  drop constraint if exists categories_compliance_scope_reason_check;
alter table public.categories
  add constraint categories_compliance_scope_reason_check
  check (compliance_scope_reason is null or char_length(btrim(compliance_scope_reason)) between 3 and 1000);

create or replace function public.is_authenticated_super_admin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select auth.uid() is not null
    and exists (
      select 1
      from public.profiles p
      where p.id = auth.uid() and p.role = 'super_admin'
    );
$$;
revoke all on function public.is_authenticated_super_admin() from public, anon;
grant execute on function public.is_authenticated_super_admin() to authenticated;

create or replace function public.enforce_category_compliance_scope()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_is_super_admin boolean := public.is_authenticated_super_admin();
begin
  if tg_op = 'INSERT' then
    -- Staff can create a taxonomy draft but it is unusable until a Super Admin
    -- classifies it. Direct API inserts cannot create an allowed category.
    if new.compliance_scope <> 'unapproved' and not v_is_super_admin then
      raise exception 'Only a Super Admin can classify a catalogue category.' using errcode = '42501';
    end if;
  elsif new.compliance_scope is distinct from old.compliance_scope
        or new.compliance_scope_reason is distinct from old.compliance_scope_reason then
    if not v_is_super_admin then
      raise exception 'Only a Super Admin can change catalogue compliance scope.' using errcode = '42501';
    end if;
  end if;
  if tg_op = 'UPDATE' and old.compliance_scope in ('cosmetics', 'fmcg')
     and (new.name is distinct from old.name or new.parent_id is distinct from old.parent_id)
     and not v_is_super_admin then
    raise exception 'Only a Super Admin can alter the taxonomy of an allowed catalogue category.' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' and new.compliance_scope in ('cosmetics', 'fmcg')
     and (new.name is distinct from old.name or new.parent_id is distinct from old.parent_id)
     and new.compliance_scope_reason is not distinct from old.compliance_scope_reason then
    raise exception 'Record an updated scope reason when changing an allowed catalogue category taxonomy.' using errcode = '22023';
  end if;

  if new.compliance_scope in ('cosmetics', 'fmcg')
     and lower(btrim(new.name)) ~ '(^|[^a-z])(food|foods|beverage|beverages|drink|drinks|edible)([^a-z]|$)' then
    raise exception 'Food categories cannot be classified as Cosmetics or FMCG.' using errcode = '23514';
  end if;

  if new.compliance_scope in ('cosmetics', 'fmcg') then
    if new.compliance_scope_reason is null or char_length(btrim(new.compliance_scope_reason)) < 3 then
      raise exception 'An owner-recorded scope reason is required for an allowed category.' using errcode = '22023';
    end if;
    new.compliance_scope_reviewed_by := auth.uid();
    new.compliance_scope_reviewed_at := clock_timestamp();
  elsif tg_op = 'INSERT' then
    new.compliance_scope_reviewed_by := null;
    new.compliance_scope_reviewed_at := null;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_enforce_category_compliance_scope on public.categories;
create trigger trg_enforce_category_compliance_scope
before insert or update on public.categories
for each row execute function public.enforce_category_compliance_scope();

-- ---------------------------------------------------------------------------
-- 2. Product compliance review and private evidence. The applicability object
-- records a reviewer decision for variables rather than pretending every field
-- is required for every item.
-- ---------------------------------------------------------------------------
create table if not exists public.product_compliance_reviews (
  id uuid primary key default uuid_generate_v4(),
  product_id uuid not null unique references public.products(id) on delete cascade,
  category_scope text not null check (category_scope in ('cosmetics', 'fmcg')),
  review_status text not null default 'pending'
    check (review_status in ('pending', 'submitted', 'approved', 'rejected', 'correction_required', 'expired')),
  applicability jsonb not null default '{}'::jsonb check (jsonb_typeof(applicability) = 'object'),
  applicability_reason text not null default '' check (char_length(btrim(applicability_reason)) <= 2000),
  manufacturer_or_importer text,
  country_of_origin text,
  batch_identifier text,
  expiry_date date,
  net_contents text,
  ingredients text,
  warnings text,
  manufacturing_licence_reference text,
  import_registration_reference text,
  supplier_invoice_reference text,
  mrp numeric(12,2),
  selling_price numeric(12,2),
  net_quantity text,
  uqc text,
  pack_size text,
  consumer_care_details text,
  evidence_reference text check (evidence_reference is null or char_length(btrim(evidence_reference)) between 3 and 500),
  review_reason text check (review_reason is null or char_length(btrim(review_reason)) between 3 and 2000),
  reviewed_by uuid references public.profiles(id),
  reviewed_at timestamptz,
  expires_at timestamptz,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint product_compliance_nonnegative_prices check (
    (mrp is null or mrp >= 0) and (selling_price is null or selling_price >= 0)
  )
);

create index if not exists idx_product_compliance_reviews_status
  on public.product_compliance_reviews (review_status, expires_at);

create table if not exists public.product_compliance_evidence (
  id uuid primary key default uuid_generate_v4(),
  product_id uuid not null references public.products(id) on delete cascade,
  -- A null seller_id is centrally-held product evidence. A non-null seller_id
  -- is seller-provided source evidence for that product and remains private.
  seller_id uuid references public.sellers(id) on delete cascade,
  evidence_type text not null check (evidence_type in (
    'label_photo', 'supplier_invoice', 'source_authorization',
    'manufacturing_licence', 'import_registration', 'country_of_origin',
    'product_source_evidence'
  )),
  storage_object_key text not null check (
    char_length(btrim(storage_object_key)) between 3 and 500
    and storage_object_key !~* '^(https?:)?//'
  ),
  file_name text check (file_name is null or char_length(btrim(file_name)) between 1 and 255),
  content_type text check (content_type is null or char_length(btrim(content_type)) between 1 and 100),
  uploaded_by uuid not null references public.profiles(id),
  created_at timestamptz not null default clock_timestamp(),
  unique (product_id, seller_id, evidence_type, storage_object_key)
);

create index if not exists idx_product_compliance_evidence_product
  on public.product_compliance_evidence (product_id, seller_id, evidence_type);

create table if not exists public.product_compliance_review_audit (
  id uuid primary key default uuid_generate_v4(),
  product_compliance_review_id uuid not null references public.product_compliance_reviews(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  actor_id uuid references public.profiles(id),
  action text not null check (action in ('created', 'pending', 'submitted', 'approved', 'rejected', 'correction_required', 'expired', 'updated')),
  before_data jsonb,
  after_data jsonb not null,
  created_at timestamptz not null default clock_timestamp()
);

create index if not exists idx_product_compliance_review_audit_review
  on public.product_compliance_review_audit (product_compliance_review_id, created_at desc);

-- ---------------------------------------------------------------------------
-- 3. Seller compliance review and private evidence. PAN, identity and bank
-- material is intentionally not duplicated into public product/offer data.
-- ---------------------------------------------------------------------------
create table if not exists public.seller_compliance_reviews (
  id uuid primary key default uuid_generate_v4(),
  seller_id uuid not null unique references public.sellers(id) on delete cascade,
  review_status text not null default 'pending'
    check (review_status in ('pending', 'submitted', 'approved', 'rejected', 'correction_required', 'expired')),
  business_identity_verified boolean not null default false,
  business_address_verified boolean not null default false,
  business_contact_verified boolean not null default false,
  gst_applicable boolean not null default false,
  gstin_verified boolean not null default false,
  seller_agreement_version text,
  seller_agreement_accepted_at timestamptz,
  product_source_evidence_verified boolean not null default false,
  cosmetics_authorization_required boolean not null default false,
  cosmetics_authorization_verified boolean not null default false,
  settlement_verified boolean not null default false,
  compliance_declaration_version text,
  compliance_declaration_accepted_at timestamptz,
  evidence_reference text check (evidence_reference is null or char_length(btrim(evidence_reference)) between 3 and 500),
  review_reason text check (review_reason is null or char_length(btrim(review_reason)) between 3 and 2000),
  reviewed_by uuid references public.profiles(id),
  reviewed_at timestamptz,
  expires_at timestamptz,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp()
);

create index if not exists idx_seller_compliance_reviews_status
  on public.seller_compliance_reviews (review_status, expires_at);

create table if not exists public.seller_compliance_evidence (
  id uuid primary key default uuid_generate_v4(),
  seller_id uuid not null references public.sellers(id) on delete cascade,
  evidence_type text not null check (evidence_type in (
    'business_identity', 'business_address', 'business_contact', 'gst_registration',
    'seller_agreement', 'settlement_verification', 'compliance_declaration',
    'product_source_evidence', 'cosmetics_authorization'
  )),
  storage_object_key text not null check (
    char_length(btrim(storage_object_key)) between 3 and 500
    and storage_object_key !~* '^(https?:)?//'
  ),
  file_name text check (file_name is null or char_length(btrim(file_name)) between 1 and 255),
  content_type text check (content_type is null or char_length(btrim(content_type)) between 1 and 100),
  uploaded_by uuid not null references public.profiles(id),
  created_at timestamptz not null default clock_timestamp(),
  unique (seller_id, evidence_type, storage_object_key)
);

create index if not exists idx_seller_compliance_evidence_seller
  on public.seller_compliance_evidence (seller_id, evidence_type);

create table if not exists public.seller_compliance_review_audit (
  id uuid primary key default uuid_generate_v4(),
  seller_compliance_review_id uuid not null references public.seller_compliance_reviews(id) on delete cascade,
  seller_id uuid not null references public.sellers(id) on delete cascade,
  actor_id uuid references public.profiles(id),
  action text not null check (action in ('created', 'pending', 'submitted', 'approved', 'rejected', 'correction_required', 'expired', 'updated')),
  before_data jsonb,
  after_data jsonb not null,
  created_at timestamptz not null default clock_timestamp()
);

create index if not exists idx_seller_compliance_review_audit_review
  on public.seller_compliance_review_audit (seller_compliance_review_id, created_at desc);

-- ---------------------------------------------------------------------------
-- 4. Approval validators and effective sale/trade predicates.
-- ---------------------------------------------------------------------------
create or replace function public.compliance_boolean(p_value jsonb, p_key text)
returns boolean
language sql
immutable
as $$
  select case
    when jsonb_typeof(p_value -> p_key) = 'boolean' then (p_value ->> p_key)::boolean
    else null
  end;
$$;

create or replace function public.product_compliance_has_evidence(
  p_product_id uuid,
  p_evidence_type text
) returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.product_compliance_evidence e
    where e.product_id = p_product_id and e.seller_id is null and e.evidence_type = p_evidence_type
  );
$$;

create or replace function public.seller_compliance_has_evidence(
  p_seller_id uuid,
  p_evidence_type text
) returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.seller_compliance_evidence e
    where e.seller_id = p_seller_id and e.evidence_type = p_evidence_type
  );
$$;

create or replace function public.assert_product_compliance_approvable(p_review public.product_compliance_reviews)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_scope text;
  v_required boolean;
begin
  select c.compliance_scope into v_scope
  from public.products p join public.categories c on c.id = p.category_id
  where p.id = p_review.product_id;

  if v_scope is null or v_scope not in ('cosmetics', 'fmcg') or v_scope <> p_review.category_scope then
    raise exception 'Product approval requires an owner-classified Cosmetics or FMCG category.' using errcode = '23514';
  end if;
  if char_length(btrim(p_review.applicability_reason)) < 3 then
    raise exception 'The reviewer must record an applicability decision and reason.' using errcode = '22023';
  end if;
  if p_review.expires_at is not null and p_review.expires_at <= clock_timestamp() then
    raise exception 'An approved product review cannot already be expired.' using errcode = '22023';
  end if;

  if p_review.category_scope = 'cosmetics' then
    foreach v_required in array array[
      public.compliance_boolean(p_review.applicability, 'batch_expiry_required'),
      public.compliance_boolean(p_review.applicability, 'manufacturing_licence_required'),
      public.compliance_boolean(p_review.applicability, 'import_registration_required')
    ] loop
      if v_required is null then
        raise exception 'Cosmetics approval requires explicit applicability decisions.' using errcode = '22023';
      end if;
    end loop;
    if nullif(btrim(p_review.manufacturer_or_importer), '') is null
       or nullif(btrim(p_review.country_of_origin), '') is null
       or nullif(btrim(p_review.net_contents), '') is null
       or nullif(btrim(p_review.ingredients), '') is null
       or nullif(btrim(p_review.warnings), '') is null
       or nullif(btrim(p_review.supplier_invoice_reference), '') is null
       or not public.product_compliance_has_evidence(p_review.product_id, 'supplier_invoice')
       or not public.product_compliance_has_evidence(p_review.product_id, 'label_photo') then
      raise exception 'Cosmetics approval is missing core label, source, manufacturer, origin, contents, ingredients or warning evidence.' using errcode = '23514';
    end if;
    if public.compliance_boolean(p_review.applicability, 'batch_expiry_required') then
      if nullif(btrim(p_review.batch_identifier), '') is null or p_review.expiry_date is null or p_review.expiry_date <= current_date then
        raise exception 'This cosmetics product requires a current batch and expiry record.' using errcode = '23514';
      end if;
    end if;
    if public.compliance_boolean(p_review.applicability, 'manufacturing_licence_required')
       and (nullif(btrim(p_review.manufacturing_licence_reference), '') is null
            or not public.product_compliance_has_evidence(p_review.product_id, 'manufacturing_licence')) then
      raise exception 'Manufacturing licence evidence is required for this cosmetics product.' using errcode = '23514';
    end if;
    if public.compliance_boolean(p_review.applicability, 'import_registration_required')
       and (nullif(btrim(p_review.import_registration_reference), '') is null
            or not public.product_compliance_has_evidence(p_review.product_id, 'import_registration')) then
      raise exception 'Import-registration evidence is required for this cosmetics product.' using errcode = '23514';
    end if;
  else
    v_required := public.compliance_boolean(p_review.applicability, 'country_of_origin_required');
    if v_required is null then
      raise exception 'FMCG approval requires a country-of-origin applicability decision.' using errcode = '22023';
    end if;
    if p_review.mrp is null or p_review.selling_price is null
       or nullif(btrim(p_review.net_quantity), '') is null
       or nullif(btrim(p_review.uqc), '') is null
       or nullif(btrim(p_review.pack_size), '') is null
       or nullif(btrim(p_review.manufacturer_or_importer), '') is null
       or nullif(btrim(p_review.consumer_care_details), '') is null
       or not public.product_compliance_has_evidence(p_review.product_id, 'label_photo') then
      raise exception 'FMCG approval is missing MRP/price, quantity/UQC, pack, manufacturer, consumer-care or label evidence.' using errcode = '23514';
    end if;
    if v_required and (nullif(btrim(p_review.country_of_origin), '') is null
                       or not public.product_compliance_has_evidence(p_review.product_id, 'country_of_origin')) then
      raise exception 'Country-of-origin evidence is required for this FMCG product.' using errcode = '23514';
    end if;
  end if;
end;
$$;

create or replace function public.assert_seller_compliance_approvable(p_review public.seller_compliance_reviews)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if p_review.expires_at is not null and p_review.expires_at <= clock_timestamp() then
    raise exception 'An approved seller review cannot already be expired.' using errcode = '22023';
  end if;
  if not p_review.business_identity_verified
     or not p_review.business_address_verified
     or not p_review.business_contact_verified
     or not p_review.product_source_evidence_verified
     or not p_review.settlement_verified
     or nullif(btrim(p_review.seller_agreement_version), '') is null
     or p_review.seller_agreement_accepted_at is null
     or nullif(btrim(p_review.compliance_declaration_version), '') is null
     or p_review.compliance_declaration_accepted_at is null
     or not public.seller_compliance_has_evidence(p_review.seller_id, 'business_identity')
     or not public.seller_compliance_has_evidence(p_review.seller_id, 'business_address')
     or not public.seller_compliance_has_evidence(p_review.seller_id, 'business_contact')
     or not public.seller_compliance_has_evidence(p_review.seller_id, 'seller_agreement')
     or not public.seller_compliance_has_evidence(p_review.seller_id, 'settlement_verification')
     or not public.seller_compliance_has_evidence(p_review.seller_id, 'compliance_declaration')
     or not public.seller_compliance_has_evidence(p_review.seller_id, 'product_source_evidence') then
    raise exception 'Seller approval is missing identity, contact/address, agreement, settlement, declaration or source-evidence verification.' using errcode = '23514';
  end if;
  if p_review.gst_applicable and (not p_review.gstin_verified
      or not public.seller_compliance_has_evidence(p_review.seller_id, 'gst_registration')) then
    raise exception 'GSTIN evidence must be verified when GST is applicable.' using errcode = '23514';
  end if;
  if p_review.cosmetics_authorization_required and (not p_review.cosmetics_authorization_verified
      or not public.seller_compliance_has_evidence(p_review.seller_id, 'cosmetics_authorization')) then
    raise exception 'Cosmetics authorization evidence is required for this seller.' using errcode = '23514';
  end if;
end;
$$;

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
      and c.compliance_scope in ('cosmetics', 'fmcg')
      and r.category_scope = c.compliance_scope
      and r.review_status = 'approved'
      and (r.expires_at is null or r.expires_at > clock_timestamp())
  );
$$;

create or replace function public.product_is_sale_eligible(p_product_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.products p
    where p.id = p_product_id
      and p.is_active
      and public.product_has_sale_eligible_compliance(p.id)
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
    from public.seller_compliance_reviews r
    where r.seller_id = p_seller_id
      and r.review_status = 'approved'
      and (r.expires_at is null or r.expires_at > clock_timestamp())
  );
$$;

create or replace function public.seller_is_trade_eligible(p_seller_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.sellers s
    where s.id = p_seller_id
      and s.status = 'active'
      and public.seller_has_trade_eligible_compliance(s.id)
  );
$$;

-- ---------------------------------------------------------------------------
-- 5. Review-state integrity/audit. Only Super Admins can approve/reject/
-- request correction/expire a review; document uploads cannot alter a status.
-- ---------------------------------------------------------------------------
revoke all on function public.product_has_sale_eligible_compliance(uuid),
  public.product_is_sale_eligible(uuid),
  public.seller_has_trade_eligible_compliance(uuid),
  public.seller_is_trade_eligible(uuid) from public, anon;
grant execute on function public.product_is_sale_eligible(uuid),
  public.seller_is_trade_eligible(uuid) to authenticated;

create or replace function public.enforce_product_compliance_review()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_is_super_admin boolean := public.is_authenticated_super_admin();
begin
  if tg_op = 'UPDATE' and old.review_status = 'approved' and new.review_status = 'approved'
     and (to_jsonb(new) - 'updated_at' - 'reviewed_by' - 'reviewed_at')
         is distinct from (to_jsonb(old) - 'updated_at' - 'reviewed_by' - 'reviewed_at') then
    raise exception 'Change an approved product review back to submitted before modifying its compliance facts.' using errcode = '23514';
  end if;
  if tg_op = 'INSERT' then
    if new.review_status not in ('pending', 'submitted') then
      raise exception 'New product compliance records must start pending or submitted.' using errcode = '23514';
    end if;
    new.reviewed_by := null;
    new.reviewed_at := null;
  elsif new.review_status is distinct from old.review_status
     or new.reviewed_by is distinct from old.reviewed_by
     or new.reviewed_at is distinct from old.reviewed_at then
    if not v_is_super_admin then
      raise exception 'Only a Super Admin may change product compliance review state.' using errcode = '42501';
    end if;
    if new.review_status not in ('pending', 'submitted', 'approved', 'rejected', 'correction_required', 'expired') then
      raise exception 'Invalid product compliance review state.' using errcode = '22023';
    end if;
    if new.review_status = 'approved' then
      perform public.assert_product_compliance_approvable(new);
    elsif new.review_status in ('rejected', 'correction_required')
       and (new.review_reason is null or char_length(btrim(new.review_reason)) < 3) then
      raise exception 'A rejection or correction request requires a reason.' using errcode = '22023';
    end if;
    new.reviewed_by := auth.uid();
    new.reviewed_at := clock_timestamp();
  end if;
  new.updated_at := clock_timestamp();
  return new;
end;
$$;

create or replace function public.enforce_seller_compliance_review()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_is_super_admin boolean := public.is_authenticated_super_admin();
begin
  if tg_op = 'UPDATE' and old.review_status = 'approved' and new.review_status = 'approved'
     and (to_jsonb(new) - 'updated_at' - 'reviewed_by' - 'reviewed_at')
         is distinct from (to_jsonb(old) - 'updated_at' - 'reviewed_by' - 'reviewed_at') then
    raise exception 'Change an approved seller review back to submitted before modifying its compliance facts.' using errcode = '23514';
  end if;
  if tg_op = 'INSERT' then
    if new.review_status not in ('pending', 'submitted') then
      raise exception 'New seller compliance records must start pending or submitted.' using errcode = '23514';
    end if;
    new.reviewed_by := null;
    new.reviewed_at := null;
  elsif new.review_status is distinct from old.review_status
     or new.reviewed_by is distinct from old.reviewed_by
     or new.reviewed_at is distinct from old.reviewed_at then
    if not v_is_super_admin then
      raise exception 'Only a Super Admin may change seller compliance review state.' using errcode = '42501';
    end if;
    if new.review_status = 'approved' then
      perform public.assert_seller_compliance_approvable(new);
    elsif new.review_status in ('rejected', 'correction_required')
       and (new.review_reason is null or char_length(btrim(new.review_reason)) < 3) then
      raise exception 'A rejection or correction request requires a reason.' using errcode = '22023';
    end if;
    new.reviewed_by := auth.uid();
    new.reviewed_at := clock_timestamp();
  end if;
  new.updated_at := clock_timestamp();
  return new;
end;
$$;

create or replace function public.audit_product_compliance_review()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_action text;
begin
  v_action := case
    when tg_op = 'INSERT' then 'created'
    when new.review_status is distinct from old.review_status then new.review_status
    else 'updated'
  end;
  insert into public.product_compliance_review_audit (
    product_compliance_review_id, product_id, actor_id, action, before_data, after_data
  ) values (
    new.id, new.product_id, auth.uid(), v_action,
    case when tg_op = 'UPDATE' then to_jsonb(old) else null end,
    to_jsonb(new)
  );
  return new;
end;
$$;

create or replace function public.audit_seller_compliance_review()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_action text;
begin
  v_action := case
    when tg_op = 'INSERT' then 'created'
    when new.review_status is distinct from old.review_status then new.review_status
    else 'updated'
  end;
  insert into public.seller_compliance_review_audit (
    seller_compliance_review_id, seller_id, actor_id, action, before_data, after_data
  ) values (
    new.id, new.seller_id, auth.uid(), v_action,
    case when tg_op = 'UPDATE' then to_jsonb(old) else null end,
    to_jsonb(new)
  );
  return new;
end;
$$;

drop trigger if exists trg_enforce_product_compliance_review on public.product_compliance_reviews;
create trigger trg_enforce_product_compliance_review
before insert or update on public.product_compliance_reviews
for each row execute function public.enforce_product_compliance_review();
drop trigger if exists trg_audit_product_compliance_review on public.product_compliance_reviews;
create trigger trg_audit_product_compliance_review
after insert or update on public.product_compliance_reviews
for each row execute function public.audit_product_compliance_review();

drop trigger if exists trg_enforce_seller_compliance_review on public.seller_compliance_reviews;
create trigger trg_enforce_seller_compliance_review
before insert or update on public.seller_compliance_reviews
for each row execute function public.enforce_seller_compliance_review();
drop trigger if exists trg_audit_seller_compliance_review on public.seller_compliance_reviews;
create trigger trg_audit_seller_compliance_review
after insert or update on public.seller_compliance_reviews
for each row execute function public.audit_seller_compliance_review();

-- ---------------------------------------------------------------------------
-- 6. Publication, seller activation, offer and final order-line enforcement.
-- Trigger names deliberately sort before the pre-existing business triggers.
-- ---------------------------------------------------------------------------
create or replace function public.enforce_product_compliance_publication()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_scope text;
begin
  if tg_op = 'UPDATE' and old.is_active and new.is_active
     and (new.name is distinct from old.name
       or new.brand_id is distinct from old.brand_id
       or new.category_id is distinct from old.category_id
       or new.unit is distinct from old.unit
       or new.units_per_case is distinct from old.units_per_case
       or new.base_price is distinct from old.base_price
       or new.gst_percent is distinct from old.gst_percent
       or new.hsn_code is distinct from old.hsn_code
       or new.barcode is distinct from old.barcode) then
    raise exception 'PRODUCT_REVIEW_REQUIRED: deactivate the product and resubmit its compliance review before changing sale-relevant product facts.' using errcode = '23514';
  end if;
  if tg_op = 'INSERT' or new.category_id is distinct from old.category_id then
    select compliance_scope into v_scope from public.categories where id = new.category_id;
    if v_scope is null or v_scope not in ('cosmetics', 'fmcg') then
      raise exception 'CATALOG_CATEGORY_BLOCKED: only owner-classified Cosmetics and FMCG categories may contain products.' using errcode = '23514';
    end if;
  end if;
  if (tg_op = 'INSERT' and new.is_active)
     or (tg_op = 'UPDATE' and new.is_active and (
       new.is_active is distinct from old.is_active
       or new.category_id is distinct from old.category_id
     )) then
    if not public.product_has_sale_eligible_compliance(new.id) then
      raise exception 'PRODUCT_COMPLIANCE_REQUIRED: product publication requires an approved, unexpired Cosmetics/FMCG compliance review.' using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;

create or replace function public.enforce_product_pack_compliance_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if (tg_op = 'INSERT' and public.product_is_sale_eligible(new.product_id))
     or (tg_op = 'UPDATE' and public.product_is_sale_eligible(new.product_id)
       and (new.pack_name is distinct from old.pack_name
         or new.units_per_case is distinct from old.units_per_case
         or new.base_price is distinct from old.base_price
         or new.mrp is distinct from old.mrp
         or new.ptr is distinct from old.ptr
         or new.case_price is distinct from old.case_price
         or new.barcode is distinct from old.barcode
         or new.is_active is distinct from old.is_active)) then
    raise exception 'PRODUCT_REVIEW_REQUIRED: deactivate the product and resubmit compliance before changing sale-relevant pack facts.' using errcode = '23514';
  end if;
  return new;
end;
$$;

create or replace function public.enforce_seller_compliance_profile_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if old.status = 'active'
     and (new.business_name is distinct from old.business_name
       or new.gstin is distinct from old.gstin
       or new.contact_name is distinct from old.contact_name
       or new.phone is distinct from old.phone
       or new.email is distinct from old.email
       or new.address_line is distinct from old.address_line)
     and public.seller_has_trade_eligible_compliance(old.id) then
    raise exception 'SELLER_REVIEW_REQUIRED: suspend or return the seller compliance review to submitted before changing verified business/contact facts.' using errcode = '23514';
  end if;
  return new;
end;
$$;

create or replace function public.enforce_seller_compliance_activation()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.status = 'active' and new.status is distinct from old.status
     and not public.seller_has_trade_eligible_compliance(new.id) then
    raise exception 'SELLER_COMPLIANCE_REQUIRED: seller activation requires an approved, unexpired compliance review.' using errcode = '23514';
  end if;
  return new;
end;
$$;

create or replace function public.enforce_seller_offer_compliance()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- An offer is a marketplace listing even while it is pending moderation;
  -- therefore no direct API caller may attach an unapproved product or an
  -- unverified/expired seller and wait for an administrative publish later.
  if not public.product_is_sale_eligible(new.product_id) then
    raise exception 'PRODUCT_COMPLIANCE_REQUIRED: an offer cannot use an unapproved, expired or out-of-scope product.' using errcode = '23514';
  end if;
  if not public.seller_is_trade_eligible(new.seller_id) then
    raise exception 'SELLER_COMPLIANCE_REQUIRED: an unverified or expired seller cannot create or publish an offer.' using errcode = '23514';
  end if;
  return new;
end;
$$;

create or replace function public.enforce_order_item_compliance()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_offer_product uuid;
  v_offer_seller uuid;
begin
  if not public.product_is_sale_eligible(new.product_id) then
    raise exception 'PRODUCT_COMPLIANCE_REQUIRED: a new order cannot contain an unapproved, expired or out-of-scope product.' using errcode = '23514';
  end if;

  if new.source_type = 'seller' then
    select so.product_id, so.seller_id into v_offer_product, v_offer_seller
    from public.seller_offers so
    where so.id = new.seller_offer_id
      and so.is_active
      and so.moderation_status = 'approved';
    if not found or v_offer_product is distinct from new.product_id
       or not public.seller_is_trade_eligible(v_offer_seller) then
      raise exception 'SELLER_COMPLIANCE_REQUIRED: a new order cannot contain an ineligible seller offer.' using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_compliance_product_publication on public.products;
create trigger trg_compliance_product_publication
before insert or update on public.products
for each row execute function public.enforce_product_compliance_publication();
drop trigger if exists trg_compliance_product_pack_change on public.product_packs;
create trigger trg_compliance_product_pack_change
before insert or update on public.product_packs
for each row execute function public.enforce_product_pack_compliance_change();
drop trigger if exists trg_compliance_seller_profile_change on public.sellers;
create trigger trg_compliance_seller_profile_change
before update on public.sellers
for each row execute function public.enforce_seller_compliance_profile_change();
drop trigger if exists trg_compliance_seller_activation on public.sellers;
create trigger trg_compliance_seller_activation
before update on public.sellers
for each row execute function public.enforce_seller_compliance_activation();
drop trigger if exists trg_compliance_seller_offer on public.seller_offers;
create trigger trg_compliance_seller_offer
before insert or update on public.seller_offers
for each row execute function public.enforce_seller_offer_compliance();
drop trigger if exists trg_compliance_order_item on public.order_items;
create trigger trg_compliance_order_item
before insert on public.order_items
for each row execute function public.enforce_order_item_compliance();

-- Retail catalogue/API visibility is a second independent boundary. Service
-- role atomic order writers still meet the final `order_items` trigger above.
drop policy if exists "categories_read" on public.categories;
create policy "categories_read" on public.categories for select using (
  public.is_staff_or_above()
  or (is_active and compliance_scope in ('cosmetics', 'fmcg'))
);

drop policy if exists "products_read" on public.products;
create policy "products_read" on public.products for select using (
  public.is_staff_or_above() or public.product_is_sale_eligible(id)
);

drop policy if exists "product_packs_read" on public.product_packs;
create policy "product_packs_read" on public.product_packs for select using (
  public.is_staff_or_above()
  or (is_active and public.product_is_sale_eligible(product_id))
);

drop policy if exists "seller_offers_trading_select" on public.seller_offers;
create policy "seller_offers_trading_select" on public.seller_offers
for select to authenticated using (
  public.is_admin_or_above()
  or public.is_active_seller_member(seller_id)
  or (
    public.current_user_role() = 'retailer'
    and public.is_active_account()
    and is_active
    and moderation_status = 'approved'
    and public.product_is_sale_eligible(product_id)
    and public.seller_is_trade_eligible(seller_id)
  )
);

-- ---------------------------------------------------------------------------
-- 7. RLS. Documents are represented only by opaque keys and are readable by
-- their owner or Super Admin. No anonymous/public evidence policy exists.
-- ---------------------------------------------------------------------------
alter table public.product_compliance_reviews enable row level security;
alter table public.product_compliance_evidence enable row level security;
alter table public.product_compliance_review_audit enable row level security;
alter table public.seller_compliance_reviews enable row level security;
alter table public.seller_compliance_evidence enable row level security;
alter table public.seller_compliance_review_audit enable row level security;

revoke all on public.product_compliance_reviews, public.product_compliance_evidence,
  public.product_compliance_review_audit, public.seller_compliance_reviews,
  public.seller_compliance_evidence, public.seller_compliance_review_audit
  from anon, authenticated;
grant select, insert, update on public.product_compliance_reviews to authenticated;
grant select, insert on public.product_compliance_evidence to authenticated;
grant select on public.product_compliance_review_audit to authenticated;
grant select, insert, update on public.seller_compliance_reviews to authenticated;
grant select, insert on public.seller_compliance_evidence to authenticated;
grant select on public.seller_compliance_review_audit to authenticated;

create policy "product_compliance_reviews_super_admin"
on public.product_compliance_reviews for all to authenticated
using (public.is_authenticated_super_admin())
with check (public.is_authenticated_super_admin());
create policy "product_compliance_evidence_super_admin"
on public.product_compliance_evidence for all to authenticated
using (public.is_authenticated_super_admin())
with check (public.is_authenticated_super_admin());
create policy "product_compliance_evidence_seller_own"
on public.product_compliance_evidence for insert to authenticated
with check (
  seller_id is not null
  and uploaded_by = auth.uid()
  and public.is_member_of_seller(seller_id)
  and exists (
    select 1 from public.seller_offers so
    where so.seller_id = product_compliance_evidence.seller_id
      and so.product_id = product_compliance_evidence.product_id
  )
);
create policy "product_compliance_evidence_seller_own_read"
on public.product_compliance_evidence for select to authenticated
using (seller_id is not null and public.is_member_of_seller(seller_id));
create policy "product_compliance_review_audit_super_admin"
on public.product_compliance_review_audit for select to authenticated
using (public.is_authenticated_super_admin());

create policy "seller_compliance_reviews_super_admin"
on public.seller_compliance_reviews for all to authenticated
using (public.is_authenticated_super_admin())
with check (public.is_authenticated_super_admin());
create policy "seller_compliance_reviews_seller_own_read"
on public.seller_compliance_reviews for select to authenticated
using (public.is_member_of_seller(seller_id));
create policy "seller_compliance_evidence_super_admin"
on public.seller_compliance_evidence for all to authenticated
using (public.is_authenticated_super_admin())
with check (public.is_authenticated_super_admin());
create policy "seller_compliance_evidence_seller_own"
on public.seller_compliance_evidence for select to authenticated
using (public.is_member_of_seller(seller_id));
create policy "seller_compliance_evidence_seller_own_insert"
on public.seller_compliance_evidence for insert to authenticated
with check (public.is_member_of_seller(seller_id) and uploaded_by = auth.uid());
create policy "seller_compliance_review_audit_super_admin"
on public.seller_compliance_review_audit for select to authenticated
using (public.is_authenticated_super_admin());

-- A deliberately non-mutating release-review report. It lets the owner identify
-- every pre-existing active category/product/offer that would be blocked after
-- enforcement rather than pretending historical records were approved.
create or replace view public.catalog_compliance_review_report
with (security_invoker = true)
as
select
  'category'::text as record_type,
  c.id as record_id,
  c.name as record_name,
  c.compliance_scope as issue,
  c.created_at as recorded_at
from public.categories c
where c.is_active and c.compliance_scope not in ('cosmetics', 'fmcg')
union all
select
  'product'::text,
  p.id,
  p.name,
  coalesce(r.review_status, 'missing_review') || ':' || coalesce(c.compliance_scope, 'missing_category'),
  p.created_at
from public.products p
left join public.categories c on c.id = p.category_id
left join public.product_compliance_reviews r on r.product_id = p.id
where p.is_active and not public.product_is_sale_eligible(p.id)
union all
select
  'seller_offer'::text,
  so.id,
  so.id::text,
  case
    when not public.product_is_sale_eligible(so.product_id) then 'product_not_eligible'
    when not public.seller_is_trade_eligible(so.seller_id) then 'seller_not_eligible'
    else 'not_trade_eligible'
  end,
  so.created_at
from public.seller_offers so
where so.is_active and so.moderation_status = 'approved'
  and (not public.product_is_sale_eligible(so.product_id)
       or not public.seller_is_trade_eligible(so.seller_id));

revoke all on public.catalog_compliance_review_report from public, anon, authenticated;

comment on view public.catalog_compliance_review_report is
  'Non-mutating review report for categories/products/offers needing Phase 2D compliance decisions; it does not certify or alter historical data.';

create or replace function public.get_catalog_compliance_review_report()
returns table (record_type text, record_id uuid, record_name text, issue text, recorded_at timestamptz)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_authenticated_super_admin() then
    raise exception 'Only an authenticated Super Admin can read the catalogue compliance review report.' using errcode = '42501';
  end if;
  return query select * from public.catalog_compliance_review_report;
end;
$$;
revoke all on function public.get_catalog_compliance_review_report() from public, anon;
grant execute on function public.get_catalog_compliance_review_report() to authenticated;

-- SECURITY DEFINER retailer projections must independently carry the same
-- eligibility predicate as RLS; they do not inherit caller RLS.
create or replace function public.marketplace_offer_quotes(p_offer_ids uuid[])
returns table (
  offer_id uuid, seller_id uuid, seller_business_name text, seller_gstin text,
  product_id uuid, pack_id uuid, fulfilment_type text, unit_price_paise bigint,
  moq integer, stock_quantity integer, in_stock boolean
)
language plpgsql stable security definer set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null
     or public.current_user_role() is distinct from 'retailer'
     or not exists (select 1 from public.retailers r where r.id = auth.uid() and r.status = 'active') then
    raise exception 'An active retailer session is required.' using errcode = '42501';
  end if;
  if coalesce(cardinality(p_offer_ids), 0) < 1 or cardinality(p_offer_ids) > 200
     or array_position(p_offer_ids, null) is not null then
    raise exception 'Request between 1 and 200 offer ids.' using errcode = '22023';
  end if;
  return query
  select so.id, s.id, s.business_name, s.gstin, so.product_id, pp.id,
         so.fulfilment_type, so.unit_price_paise, so.moq,
         case when so.fulfilment_type = 'seller' then so.stock_quantity else pp.stock_quantity end,
         case when so.fulfilment_type = 'seller' then coalesce(so.stock_quantity, 0) >= so.moq else pp.stock_quantity >= so.moq end
    from public.seller_offers so
    join public.sellers s on s.id = so.seller_id
    join public.product_packs pp on pp.id = so.pack_id and pp.product_id = so.product_id
   where so.id = any(p_offer_ids)
     and so.is_active and so.moderation_status = 'approved'
     and so.unit_price_paise >= coalesce(public.current_offer_floor_paise(so.pack_id), 0)
     and pp.is_active
     and public.product_is_sale_eligible(so.product_id)
     and public.seller_is_trade_eligible(so.seller_id)
   order by so.id;
end;
$$;

create or replace function public.marketplace_offers_for_product(p_product_id uuid)
returns table (
  offer_id uuid, seller_id uuid, seller_business_name text, seller_gstin text,
  pack_id uuid, pack_name text, fulfilment_type text, unit_price_paise bigint,
  moq integer, in_stock boolean
)
language plpgsql stable security definer set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null
     or public.current_user_role() is distinct from 'retailer'
     or not exists (select 1 from public.retailers r where r.id = auth.uid() and r.status = 'active') then
    raise exception 'An active retailer session is required.' using errcode = '42501';
  end if;
  return query
  select so.id, s.id, s.business_name, s.gstin, pp.id, pp.pack_name,
         so.fulfilment_type, so.unit_price_paise, so.moq,
         case when so.fulfilment_type = 'seller' then coalesce(so.stock_quantity, 0) >= so.moq else pp.stock_quantity >= so.moq end
    from public.seller_offers so
    join public.sellers s on s.id = so.seller_id
    join public.product_packs pp on pp.id = so.pack_id and pp.product_id = so.product_id
   where so.product_id = p_product_id
     and so.is_active and so.moderation_status = 'approved'
     and so.unit_price_paise >= coalesce(public.current_offer_floor_paise(so.pack_id), 0)
     and pp.is_active
     and public.product_is_sale_eligible(so.product_id)
     and public.seller_is_trade_eligible(so.seller_id)
   order by so.unit_price_paise, s.business_name, so.id;
end;
$$;

create or replace function public.marketplace_offer_tiers(p_offer_ids uuid[])
returns table (offer_id uuid, min_quantity integer, max_quantity integer, unit_price_paise bigint)
language plpgsql stable security definer set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;
  if coalesce(cardinality(p_offer_ids), 0) < 1 or cardinality(p_offer_ids) > 200
     or array_position(p_offer_ids, null) is not null then
    raise exception 'Request between 1 and 200 offer ids.' using errcode = '22023';
  end if;
  return query
  select sot.seller_offer_id, sot.min_quantity, sot.max_quantity, sot.unit_price_paise
    from public.seller_offer_tiers sot
    join public.seller_offers so on so.id = sot.seller_offer_id
   where sot.seller_offer_id = any(p_offer_ids) and sot.is_active
     and (public.is_admin_or_above()
          or public.is_active_seller_member(so.seller_id)
          or (public.current_user_role() = 'retailer' and public.is_active_account()
              and so.is_active and so.moderation_status = 'approved'
              and public.product_is_sale_eligible(so.product_id)
              and public.seller_is_trade_eligible(so.seller_id)))
   order by sot.seller_offer_id, sot.min_quantity;
end;
$$;
