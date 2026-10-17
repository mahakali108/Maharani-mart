-- ============================================================================
-- 0060: Durable rate limiting for the public supplier application form.
--
-- WHY: the supplier submission action previously throttled in process
-- memory, keyed by phone only (FixedWindowRateLimiter). That resets on
-- restart, differs per instance, and is defeated by phone rotation.
-- This migration adds the database-backed counterpart of the existing AI
-- limiter (0018, consume_ai_rate_limit — which cannot be reused here
-- because it requires an authenticated auth.uid() and keys rows to
-- profiles). The design follows that proven pattern:
--
--   * Keys are SHA-256 hashes computed server-side. Raw phone numbers,
--     email addresses and IP addresses are NEVER stored in this table.
--   * Writes happen ONLY through the SECURITY DEFINER function below:
--     a single INSERT ... ON CONFLICT DO UPDATE statement, so concurrent
--     submissions cannot race a read-modify-write in application code.
--   * The table has RLS enabled, no policies, and all privileges revoked
--     from anon/authenticated: no API role can read, enumerate or tamper
--     with limiter state directly.
--   * The function is an INTERNAL server-only mechanism (audit N1): it
--     is executable ONLY by service_role. The public submission action
--     calls it through the privileged server client
--     (createServiceRoleClient); anon/authenticated have no EXECUTE, so
--     a direct PostgREST RPC call with an invented key hash is denied
--     before any validation or table mutation. PostgreSQL would
--     otherwise default EXECUTE to PUBLIC — hence the explicit revokes
--     below. The separate public submission RPC (0059,
--     submit_supplier_application) is unchanged and remains the only
--     anon-callable supplier write path.
--   * Retention is bounded: each consume opportunistically deletes the
--     caller's own expired rows, and an index on window_started_at
--     supports periodic cleanup of stale windows (e.g. alongside the
--     0055 retention job). Rows hold hashes + counters only.
--
-- LIMITS (stated honestly): a database limiter raises the bar; it does
-- not defeat distributed abuse or botnets. The client-identity bucket is
-- best-effort (see lib/admin/supplier-rate-limit.ts for the proxy-trust
-- note). Availability behaviour if this function is missing/failing is
-- fail-open to the in-memory limiter, so registration never hard-depends
-- on this migration — which is why applying it is still recommended.
--
-- NOT APPLIED to any project by this file. Rollback:
-- supabase/rollbacks/0060_supplier_application_rate_limit.down.sql
-- ============================================================================

create table if not exists supplier_application_rate_limits (
  -- SHA-256 hex (64 chars) of a server-side salted identifier. Never a
  -- raw phone number, email address or IP address.
  key_hash text not null check (key_hash ~ '^[0-9a-f]{64}$'),
  bucket text not null check (char_length(bucket) between 1 and 40),
  window_started_at timestamptz not null,
  request_count int not null check (request_count >= 0),
  primary key (key_hash, bucket)
);
create index if not exists idx_supplier_rate_limits_window
  on supplier_application_rate_limits (window_started_at);

alter table supplier_application_rate_limits enable row level security;
-- No policies on purpose: the definer function below is the only path.
revoke all on supplier_application_rate_limits from anon, authenticated;

create or replace function consume_supplier_application_rate_limit(
  p_key_hash text,
  p_bucket text,
  p_limit int,
  p_window_seconds int
) returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp
as $$
declare
  v_row supplier_application_rate_limits%rowtype;
  v_now timestamptz := clock_timestamp();
begin
  -- Explicit NULL rejection (audit N5): PL/pgSQL treats NULL conditions
  -- as not-true, so relying on the checks below would fail only
  -- incidentally on downstream constraints. Reject deliberately, before
  -- any comparison, arithmetic or table mutation.
  if p_key_hash is null or p_bucket is null
     or p_limit is null or p_window_seconds is null then
    raise exception 'Invalid rate limit configuration.';
  end if;

  if p_key_hash !~ '^[0-9a-f]{64}$'
     or p_bucket !~ '^[a-z0-9_-]{1,40}$'
     or p_limit < 1 or p_limit > 1000
     or p_window_seconds < 1 or p_window_seconds > 86400 then
    raise exception 'Invalid rate limit configuration.';
  end if;

  -- Bounded retention (audit F2): remove this caller's own long-expired
  -- windows, plus at most 100 expired rows in this bucket per call
  -- (window index-backed). Only rows >7 days old are touched; live
  -- windows (<= 1 day by validation) can never be deleted here, so
  -- cleanup cannot reopen an active window or race a burst open.
  -- Rows in attacker-invented buckets are NOT covered by this; the owner
  -- must add this table to the periodic retention cleanup when applying
  -- this migration (see proposal) — no schedule is assumed here.
  delete from supplier_application_rate_limits
   where key_hash = p_key_hash
     and window_started_at < v_now - interval '7 days';
  delete from supplier_application_rate_limits
   where key_hash in (
     select key_hash from supplier_application_rate_limits
      where bucket = p_bucket
        and window_started_at < v_now - interval '7 days'
      order by window_started_at
      limit 100
   ) and bucket = p_bucket;

  -- Atomic consume: one upsert, no application-level read-modify-write.
  insert into supplier_application_rate_limits(key_hash, bucket, window_started_at, request_count)
  values (p_key_hash, p_bucket, v_now, 1)
  on conflict (key_hash, bucket) do update set
    window_started_at = case
      when supplier_application_rate_limits.window_started_at + make_interval(secs => p_window_seconds) <= v_now
      then v_now else supplier_application_rate_limits.window_started_at end,
    request_count = case
      when supplier_application_rate_limits.window_started_at + make_interval(secs => p_window_seconds) <= v_now
      then 1 else least(supplier_application_rate_limits.request_count + 1, p_limit + 1) end
      -- capped at limit+1 (audit F4): decisions, remaining and retry_after
      -- are unchanged (count > limit already means blocked), but blocked
      -- callers can no longer grow the counter/write load without bound.
  returning * into v_row;

  return jsonb_build_object(
    'allowed', v_row.request_count <= p_limit,
    'remaining', greatest(0, p_limit - v_row.request_count),
    'retry_after_seconds', case
      when v_row.request_count <= p_limit then 0
      else greatest(1, ceil(extract(epoch from
        (v_row.window_started_at + make_interval(secs => p_window_seconds) - v_now)))::int) end
  );
end;
$$;

-- Server-only execution (audit N1). Revoke PUBLIC (the PostgreSQL
-- default) AND the untrusted API roles explicitly — default privileges
-- in some environments grant EXECUTE to anon/authenticated directly,
-- which a PUBLIC-only revoke would not remove. Only the trusted
-- server role may execute; it is called exclusively from server code
-- via the service-role client, never from a browser.
revoke all on function consume_supplier_application_rate_limit(text, text, int, int) from public, anon, authenticated;
grant execute on function consume_supplier_application_rate_limit(text, text, int, int) to service_role;

-- ============================================================================
-- END OF MIGRATION 0060 (unapplied; see header)
-- ============================================================================
