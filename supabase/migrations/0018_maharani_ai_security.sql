-- ============================================================================
-- 0018: Maharani AI security support
-- Metadata-only observability, safe opt-in business memory, distributed rate
-- limits, and a retailer-safe aggregate availability RPC. No provider keys,
-- prompts, chat transcripts or business rules are stored here.
-- ============================================================================

create table if not exists ai_business_memory (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references profiles(id) on delete cascade,
  memory_key text not null check (memory_key in ('preferred_category', 'preferred_brand', 'frequent_product', 'typical_order_size', 'reorder_preference')),
  memory_value text not null check (char_length(memory_value) between 1 and 160),
  source text not null default 'user_confirmed' check (source in ('user_confirmed', 'business_history')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, memory_key, memory_value)
);

alter table ai_business_memory enable row level security;
create policy "ai_memory_owner_read" on ai_business_memory for select using (user_id = auth.uid());
create policy "ai_memory_owner_insert" on ai_business_memory for insert with check (user_id = auth.uid());
create policy "ai_memory_owner_update" on ai_business_memory for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "ai_memory_owner_delete" on ai_business_memory for delete using (user_id = auth.uid());

create table if not exists ai_audit_logs (
  id bigint generated always as identity primary key,
  request_id uuid not null,
  user_id uuid not null references profiles(id) on delete cascade,
  surface text not null check (surface in ('retailer', 'salesman', 'staff', 'admin')),
  provider text,
  model text,
  request_type text not null check (request_type in ('chat', 'tool', 'memory_reset')),
  tool_name text,
  duration_ms int not null default 0 check (duration_ms >= 0),
  success boolean not null,
  error_code text,
  input_tokens int,
  output_tokens int,
  total_tokens int,
  created_at timestamptz not null default now()
);
create index if not exists idx_ai_audit_user_created on ai_audit_logs(user_id, created_at desc);
create index if not exists idx_ai_audit_tool_created on ai_audit_logs(tool_name, created_at desc) where tool_name is not null;
alter table ai_audit_logs enable row level security;
create policy "ai_audit_self_insert" on ai_audit_logs for insert with check (user_id = auth.uid());
create policy "ai_audit_admin_read" on ai_audit_logs for select using (is_admin_or_above());

create table if not exists ai_rate_limit_windows (
  user_id uuid not null references profiles(id) on delete cascade,
  bucket text not null check (char_length(bucket) between 1 and 40),
  window_started_at timestamptz not null,
  request_count int not null check (request_count >= 0),
  primary key (user_id, bucket)
);
alter table ai_rate_limit_windows enable row level security;
-- No direct policies: callers can only consume their own bucket through RPC.

create or replace function consume_ai_rate_limit(
  p_bucket text,
  p_limit int,
  p_window_seconds int
) returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_row ai_rate_limit_windows%rowtype;
  v_now timestamptz := clock_timestamp();
begin
  if v_uid is null then raise exception 'Authentication required.'; end if;
  if p_bucket !~ '^[a-z0-9_-]{1,40}$' or p_limit < 1 or p_limit > 1000 or p_window_seconds < 1 or p_window_seconds > 86400 then
    raise exception 'Invalid rate limit configuration.';
  end if;

  insert into ai_rate_limit_windows(user_id, bucket, window_started_at, request_count)
  values (v_uid, p_bucket, v_now, 1)
  on conflict (user_id, bucket) do update set
    window_started_at = case when ai_rate_limit_windows.window_started_at + make_interval(secs => p_window_seconds) <= v_now then v_now else ai_rate_limit_windows.window_started_at end,
    request_count = case when ai_rate_limit_windows.window_started_at + make_interval(secs => p_window_seconds) <= v_now then 1 else ai_rate_limit_windows.request_count + 1 end
  returning * into v_row;

  return jsonb_build_object(
    'allowed', v_row.request_count <= p_limit,
    'remaining', greatest(0, p_limit - v_row.request_count),
    'retry_after_seconds', case when v_row.request_count <= p_limit then 0 else greatest(1, ceil(extract(epoch from (v_row.window_started_at + make_interval(secs => p_window_seconds) - v_now)))::int) end
  );
end;
$$;
revoke all on function consume_ai_rate_limit(text, int, int) from public;
grant execute on function consume_ai_rate_limit(text, int, int) to authenticated;

create table if not exists ai_confirmed_actions (
  nonce text primary key,
  user_id uuid not null references profiles(id) on delete cascade,
  consumed_at timestamptz not null default now()
);
alter table ai_confirmed_actions enable row level security;
-- No direct policies. Atomic one-time consumption is available only via RPC.

create or replace function consume_ai_confirmation(p_nonce text)
returns boolean
language plpgsql volatile security definer set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then raise exception 'Authentication required.'; end if;
  if p_nonce !~ '^[0-9a-f-]{36}$' then raise exception 'Invalid confirmation nonce.'; end if;
  insert into ai_confirmed_actions(nonce, user_id) values (p_nonce, auth.uid())
  on conflict (nonce) do nothing;
  return found;
end;
$$;
revoke all on function consume_ai_confirmation(text) from public;
grant execute on function consume_ai_confirmation(text) to authenticated;

-- Retailers need availability for product discovery, but not warehouse, batch,
-- cost or reservation details. This explicitly returns only a product aggregate.
create or replace function get_retailer_product_availability(p_product_ids uuid[])
returns table(product_id uuid, available_quantity bigint, stock_status text)
language plpgsql stable security definer set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then raise exception 'Authentication required.'; end if;
  if coalesce(array_length(p_product_ids, 1), 0) > 100 then raise exception 'Too many products.'; end if;
  if current_user_role() = 'retailer' and not exists (
    select 1 from retailers r where r.id = auth.uid() and r.status = 'active'
  ) then raise exception 'Active retailer required.';
  end if;
  if current_user_role() not in ('retailer', 'staff', 'admin', 'super_admin') then
    raise exception 'Not authorized for product availability.';
  end if;

  return query
  select p.id,
         coalesce(sum(s.quantity - s.reserved_quantity), 0)::bigint,
         case
           when coalesce(sum(s.quantity - s.reserved_quantity), 0) <= 0 then 'out_of_stock'
           when p.reorder_level > 0 and coalesce(sum(s.quantity - s.reserved_quantity), 0) <= p.reorder_level then 'low_stock'
           else 'in_stock'
         end
  from products p
  left join inventory_stock s on s.product_id = p.id
  where p.id = any(p_product_ids) and p.is_active
  group by p.id, p.reorder_level;
end;
$$;
revoke all on function get_retailer_product_availability(uuid[]) from public;
grant execute on function get_retailer_product_availability(uuid[]) to authenticated;

-- Retain only metadata needed for operational monitoring.
comment on table ai_audit_logs is 'AI request/tool metadata only. Never store prompts, arguments, results, documents or secrets.';
