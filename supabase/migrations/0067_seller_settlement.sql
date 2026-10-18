-- ============================================================================
-- 0067: Seller Marketplace — settlement plane: collection allocations, seller
--       ledger, payouts table (DISABLED), child-scoped coin refunds.
--
-- WHAT THIS ADDS
--   * `collection_allocations` — money-in attribution of a verified
--     `payment_collections` row to sub-orders (partial settlement shares).
--     Idempotency key `alloc:<allocation id>`.
--   * `seller_ledger` — the seller AP plane (distinct from retailer wallet AR:
--     retailer Coins credit is NOT seller money). Append-only (0017 ledger
--     convention), integer paise, deterministic idempotency keys. Allocation
--     postings use `alloc:<allocation id>`. Commission is SNAPSHOTTED on
--     sub_orders (0064) but NO commission/payout postings are written — the
--     basis (gross-vs-net) is an owner decision and stays 'undecided'.
--   * `seller_payouts` — table only. Payout ACTIONS are deliberately absent
--     (gated on the owner's payout-basis decision); RLS is admin-only.
--   * `refund_sub_order_coins(p_sub_order_id, p_amount_paise, p_reason)` —
--     child-scoped wallet reversal. Each ORDER_DEBIT the child created
--     ('order:<parent>:<child>') is reversed at most ONCE via its own
--     `reversal:<debit id>` key (the 0053 convention), capped by the requested
--     amount and by the child's unreversed debits. Legacy `refund_order_coins`
--     (0053) stays byte-identical for single-debit legacy orders.
--
-- SAFETY: additive. NO fabricated invoices, credit notes or payouts: there is
-- no invoice/credit-note artifact in this repository (qualified tax review is
-- an owner/legal decision and out of scope). NOT executed against any database.
-- ============================================================================

create table if not exists public.collection_allocations (
  id uuid primary key default uuid_generate_v4(),
  payment_collection_id uuid not null references public.payment_collections(id) on delete restrict,
  sub_order_id uuid not null references public.sub_orders(id) on delete restrict,
  amount_paise bigint not null check (amount_paise > 0),
  idempotency_key text not null unique,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  unique (payment_collection_id, sub_order_id)
);

create index if not exists idx_collection_allocations_sub_order
  on public.collection_allocations (sub_order_id);

create table if not exists public.seller_ledger (
  id uuid primary key default uuid_generate_v4(),
  seller_id uuid not null references public.sellers(id) on delete restrict,
  sub_order_id uuid references public.sub_orders(id) on delete restrict,
  entry_type text not null
    check (entry_type in ('ALLOCATION', 'COMMISSION', 'PAYOUT', 'ADJUSTMENT', 'REVERSAL')),
  amount_paise bigint not null check (amount_paise <> 0),
  currency text not null default 'INR' check (char_length(currency) = 3),
  idempotency_key text not null unique,
  description text check (description is null or char_length(btrim(description)) <= 300),
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

create index if not exists idx_seller_ledger_seller on public.seller_ledger (seller_id, created_at desc);
create index if not exists idx_seller_ledger_sub_order on public.seller_ledger (sub_order_id);

-- Append-only (clone of the 0017/0053 ledger discipline).
create or replace function public.prevent_seller_ledger_mutation()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  raise exception 'The seller ledger is append-only.' using errcode = '42501';
end;
$$;

drop trigger if exists trg_prevent_seller_ledger_mutation on public.seller_ledger;
create trigger trg_prevent_seller_ledger_mutation
  before update or delete on public.seller_ledger
  for each row execute function public.prevent_seller_ledger_mutation();

drop trigger if exists trg_prevent_collection_alloc_mutation on public.collection_allocations;
create trigger trg_prevent_collection_alloc_mutation
  before update or delete on public.collection_allocations
  for each row execute function public.prevent_seller_ledger_mutation();

-- Payouts: TABLE ONLY, actions gated on the owner's payout-basis decision.
create table if not exists public.seller_payouts (
  id uuid primary key default uuid_generate_v4(),
  seller_id uuid not null references public.sellers(id) on delete restrict,
  amount_paise bigint not null check (amount_paise > 0),
  status text not null default 'requested'
    check (status in ('requested', 'approved', 'paid', 'cancelled')),
  reference_note text check (reference_note is null or char_length(btrim(reference_note)) <= 300),
  requested_by uuid references public.profiles(id),
  approved_by uuid references public.profiles(id),
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Collection → sub-order allocation (admin/server). Writes both planes with
-- one shared deterministic key: alloc:<allocation id>.
-- ---------------------------------------------------------------------------
create or replace function public.allocate_payment_collection(
  p_collection_id uuid,
  p_sub_order_id uuid,
  p_amount_paise bigint
) returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_collection public.payment_collections%rowtype;
  v_sub public.sub_orders%rowtype;
  v_allocated bigint;
  v_allocation_id uuid;
  v_actor uuid := coalesce(auth.uid(), '00000000-0000-0000-0000-000000000000'::uuid);
begin
  if auth.role() is distinct from 'service_role'
     and (auth.uid() is null or not public.is_admin_or_above()) then
    raise exception 'Collection allocation is admin/server only.' using errcode = '42501';
  end if;
  if p_collection_id is null or p_sub_order_id is null
     or p_amount_paise is null or p_amount_paise <= 0 then
    raise exception 'Invalid allocation request.' using errcode = '22023';
  end if;

  select * into v_collection from public.payment_collections where id = p_collection_id for update;
  if not found then
    raise exception 'Payment collection not found.' using errcode = 'P0002';
  end if;
  select * into v_sub from public.sub_orders where id = p_sub_order_id for update;
  if not found then
    raise exception 'Sub-order not found.' using errcode = 'P0002';
  end if;
  if v_sub.parent_order_id is distinct from v_collection.order_id then
    raise exception 'This collection belongs to a different order.' using errcode = '23514';
  end if;

  select coalesce(sum(ca.amount_paise), 0)
    into v_allocated
    from public.collection_allocations ca
   where ca.payment_collection_id = p_collection_id;
  if v_allocated + p_amount_paise > v_collection.amount_paise then
    raise exception 'Allocations exceed the collected amount.' using errcode = '23514';
  end if;

  v_allocation_id := gen_random_uuid();
  insert into public.collection_allocations
    (id, payment_collection_id, sub_order_id, amount_paise, idempotency_key, created_by)
  values
    (v_allocation_id, p_collection_id, p_sub_order_id, p_amount_paise,
     'alloc:' || v_allocation_id::text, v_actor);

  insert into public.seller_ledger
    (seller_id, sub_order_id, entry_type, amount_paise, idempotency_key, description, created_by)
  values
    (
      v_sub.seller_id,
      p_sub_order_id,
      'ALLOCATION',
      p_amount_paise,
      'alloc:' || v_allocation_id::text,
      'Collection allocation for sub-order ' || p_sub_order_id::text,
      v_actor
    )
  on conflict (idempotency_key) do nothing;

  return v_allocation_id;
end;
$$;
revoke all on function public.allocate_payment_collection(uuid, uuid, bigint) from public, anon, authenticated;
grant execute on function public.allocate_payment_collection(uuid, uuid, bigint) to service_role;

-- ---------------------------------------------------------------------------
-- Child-scoped coin refund (0053 mechanics, per-debit exactly-once keys).
-- ---------------------------------------------------------------------------
create or replace function public.refund_sub_order_coins(
  p_sub_order_id uuid,
  p_amount_paise bigint,
  p_reason text default null,
  p_created_by uuid default null
) returns bigint
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_sub public.sub_orders%rowtype;
  v_retailer_id uuid;
  v_parent_status public.order_status;
  v_debit public.retailer_wallet_ledger%rowtype;
  v_account_id uuid;
  v_ledger_id uuid;
  v_actor uuid;
  v_reason text;
  v_remaining bigint;
  v_refunded bigint := 0;
  v_part bigint;
begin
  if p_sub_order_id is null then
    raise exception 'Sub-order id is required.' using errcode = '22023';
  end if;
  if p_amount_paise is null or p_amount_paise <= 0 then
    raise exception 'Refund amount must be positive.' using errcode = '22023';
  end if;

  select * into v_sub from public.sub_orders where id = p_sub_order_id;
  if not found then
    raise exception 'Sub-order % was not found.', p_sub_order_id using errcode = 'P0002';
  end if;

  select o.retailer_id, o.status
    into v_retailer_id, v_parent_status
    from public.orders o
   where o.id = v_sub.parent_order_id;

  -- Same authorization shape as 0053: the shop itself, staff/admin, or an
  -- internal call. Sellers never touch retailer wallets.
  if auth.uid() is not null
     and auth.uid() <> v_retailer_id
     and not public.is_staff_or_above() then
    raise exception 'Access denied: you cannot refund coins for this sub-order.' using errcode = '42501';
  end if;

  -- Value reversal only on a non-delivered terminal outcome of the CHILD.
  if v_sub.status not in ('cancelled', 'returned') then
    raise exception 'Sub-order % is not refundable in status %.', p_sub_order_id, v_sub.status
      using errcode = '22023';
  end if;

  v_actor := coalesce(p_created_by, auth.uid(), v_retailer_id);
  v_reason := coalesce(nullif(trim(coalesce(p_reason, '')), ''), 'Sub-order refunded');
  v_remaining := p_amount_paise;

  -- The child's own debits, deterministic order; each reverses at most once.
  for v_debit in
    select *
      from public.retailer_wallet_ledger
     where retailer_id = v_retailer_id
       and reference_type = 'order'
       and reference_id = v_sub.parent_order_id
       and transaction_type = 'ORDER_DEBIT'
       and idempotency_key = 'order:' || v_sub.parent_order_id::text || ':' || p_sub_order_id::text
       and not is_reversed
     order by created_at
     for update
  loop
    exit when v_remaining <= 0;
    v_part := least(v_remaining, v_debit.amount_paise);

    select id into v_account_id
      from public.retailer_credit_accounts
     where retailer_id = v_retailer_id;

    insert into public.retailer_wallet_ledger (
      retailer_id, account_id, transaction_type, amount_paise, direction,
      reference_type, reference_id, description, reason, created_by, notes,
      idempotency_key, metadata, reversal_of
    ) values (
      v_retailer_id, v_account_id, 'ORDER_REVERSAL', v_part, 'credit',
      'order', v_sub.parent_order_id,
      format('Reversal of sub-order %s — %s', p_sub_order_id, v_reason),
      v_reason, v_actor,
      format('Reverses ORDER_DEBIT %s', v_debit.id),
      'reversal:' || v_debit.id::text,
      jsonb_build_object('reversal_of', v_debit.id, 'order_id', v_sub.parent_order_id, 'sub_order_id', p_sub_order_id),
      v_debit.id
    )
    on conflict (idempotency_key) do nothing
    returning id into v_ledger_id;

    -- Idempotent success: a retry already wrote this exact reversal.
    if v_ledger_id is null then
      v_remaining := v_remaining - v_part;
      v_refunded := v_refunded + v_part;
      continue;
    end if;

    update public.retailer_wallet_ledger
       set is_reversed = true,
           reversed_at = now(),
           reversed_by = v_actor
     where id = v_debit.id
       and is_reversed = false;

    v_remaining := v_remaining - v_part;
    v_refunded := v_refunded + v_part;
  end loop;

  return v_refunded;
end;
$$;

comment on function public.refund_sub_order_coins(uuid, bigint, text, uuid) is
  'Child-scoped coin refund: reverses the ORDER_DEBIT rows this sub-order created (keys order:<parent>:<child>) with exactly-once reversal:<debit id> credits, capped by the requested amount. Legacy refund_order_coins is untouched.';

revoke all on function public.refund_sub_order_coins(uuid, bigint, text, uuid) from public, anon;
grant execute on function public.refund_sub_order_coins(uuid, bigint, text, uuid) to authenticated;
grant execute on function public.refund_sub_order_coins(uuid, bigint, text, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- RLS + grants.
-- ---------------------------------------------------------------------------
alter table public.collection_allocations enable row level security;
alter table public.seller_ledger enable row level security;
alter table public.seller_payouts enable row level security;

revoke all on public.collection_allocations from anon, authenticated;
revoke all on public.seller_ledger from anon, authenticated;
revoke all on public.seller_payouts from anon, authenticated;

grant select on public.collection_allocations to authenticated;
grant select on public.seller_ledger to authenticated;
grant select on public.seller_payouts to authenticated;

drop policy if exists "collection_allocations_read" on public.collection_allocations;
create policy "collection_allocations_read" on public.collection_allocations
  for select using (is_admin_or_above());

drop policy if exists "seller_ledger_read" on public.seller_ledger;
create policy "seller_ledger_read" on public.seller_ledger
  for select using (
    is_admin_or_above()
    or public.is_member_of_seller(seller_id)
  );

drop policy if exists "seller_payouts_admin_read" on public.seller_payouts;
create policy "seller_payouts_admin_read" on public.seller_payouts
  for select using (is_admin_or_above());

comment on table public.seller_ledger is
  'Seller AP plane (integer paise), append-only. Distinct from retailer wallet AR. Commission/payout postings are gated on the owner payout-basis decision.';
comment on table public.seller_payouts is
  'Payout requests. NO payout actions exist until the owner approves the payout basis (gross-vs-net is undecided).';

-- ============================================================================
-- END OF MIGRATION.
-- ============================================================================
