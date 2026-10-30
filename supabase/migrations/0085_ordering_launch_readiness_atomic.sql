-- ============================================================================
-- Ordering launch-readiness: protected, auditable, fail-closed persistence.
--
-- This migration is LOCAL REVIEW ONLY until explicitly applied through the
-- project's normal database release process. It deliberately changes only the
-- `ordering_launch_readiness` key: other platform_settings keys keep their
-- existing Super Admin RLS behaviour.
-- ============================================================================

-- A Super Admin may continue to manage unrelated platform settings directly,
-- but this launch gate may only be written through the audited RPC below.
drop policy if exists "platform_settings_admin_all" on public.platform_settings;

create policy "platform_settings_admin_select"
  on public.platform_settings for select
  using (public.current_user_role() = 'super_admin');

create policy "platform_settings_admin_insert_non_readiness"
  on public.platform_settings for insert
  with check (
    public.current_user_role() = 'super_admin'
    and key <> 'ordering_launch_readiness'
  );

create policy "platform_settings_admin_update_non_readiness"
  on public.platform_settings for update
  using (
    public.current_user_role() = 'super_admin'
    and key <> 'ordering_launch_readiness'
  )
  with check (
    public.current_user_role() = 'super_admin'
    and key <> 'ordering_launch_readiness'
  );

create policy "platform_settings_admin_delete_non_readiness"
  on public.platform_settings for delete
  using (
    public.current_user_role() = 'super_admin'
    and key <> 'ordering_launch_readiness'
  );

-- The function owns both writes. PostgreSQL executes one RPC invocation in a
-- single transaction: if validation, the settings upsert, or audit insertion
-- fails, the entire invocation rolls back. It stamps identity/time from the
-- authenticated database session and never accepts them from a client.
create or replace function public.record_ordering_launch_readiness(
  p_approvals jsonb,
  p_reason text default null
) returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor_id uuid := auth.uid();
  v_before jsonb;
  v_value jsonb;
  v_category jsonb;
  v_key text;
  v_status text;
  v_reference text;
  v_valid_until_text text;
  v_valid_until timestamptz;
  v_canonical_valid_until text;
  v_recorded_at text;
  v_key_count integer;
begin
  -- Do not rely on `current_user_role() <> 'super_admin'`: a missing profile
  -- produces NULL, and PL/pgSQL does not enter an IF branch whose condition is
  -- NULL. The protected writer must require a real profile row with this role.
  if v_actor_id is null or not exists (
    select 1
    from public.profiles as actor_profile
    where actor_profile.id = v_actor_id
      and actor_profile.role = 'super_admin'
  ) then
    raise exception 'Only an authenticated Super Admin can record ordering launch readiness.' using errcode = '42501';
  end if;

  if jsonb_typeof(p_approvals) <> 'object' then
    raise exception 'Ordering launch readiness must be an object.' using errcode = '22023';
  end if;

  select count(*) into v_key_count from jsonb_object_keys(p_approvals);
  if v_key_count <> 8 then
    raise exception 'Ordering launch readiness has an unexpected set of fields.' using errcode = '22023';
  end if;

  foreach v_key in array array[
    'businessIdentity',
    'publicContacts',
    'legalPolicies',
    'gstInvoice',
    'marketplaceTaxTcsSettlement',
    'deliveryCodCancellationsRefunds',
    'privacyReadiness'
  ] loop
    if not (p_approvals ? v_key) then
      raise exception 'Ordering launch readiness is missing category %.', v_key using errcode = '22023';
    end if;

    v_category := p_approvals -> v_key;
    if jsonb_typeof(v_category) <> 'object' then
      raise exception 'Ordering launch readiness category % is invalid.', v_key using errcode = '22023';
    end if;
    select count(*) into v_key_count from jsonb_object_keys(v_category);
    v_status := v_category ->> 'status';

    if v_status = 'pending' then
      if v_key_count <> 1 then
        raise exception 'Pending readiness category % has unexpected fields.', v_key using errcode = '22023';
      end if;
    elsif v_status = 'approved' then
      if v_key_count <> 2 or jsonb_typeof(v_category -> 'approvalReference') <> 'string' then
        raise exception 'Approved readiness category % is invalid.', v_key using errcode = '22023';
      end if;
      v_reference := btrim(v_category ->> 'approvalReference');
      if char_length(v_reference) < 3
        or char_length(v_reference) > 200
        or v_reference ~* '^(n/?a|tbd|todo|placeholder|owner input required|x{2,}|-+)$' then
        raise exception 'Approved readiness category % needs a valid approval reference.', v_key using errcode = '22023';
      end if;
    else
      raise exception 'Readiness category % must be pending or approved.', v_key using errcode = '22023';
    end if;
  end loop;

  if not (p_approvals ? 'approvalValidityPolicy') then
    raise exception 'An explicit approval validity policy is required.' using errcode = '22023';
  end if;
  v_category := p_approvals -> 'approvalValidityPolicy';
  if jsonb_typeof(v_category) <> 'object' then
    raise exception 'Approval validity policy is invalid.' using errcode = '22023';
  end if;
  select count(*) into v_key_count from jsonb_object_keys(v_category);
  if v_key_count <> 3
    or v_category ->> 'status' <> 'configured'
    or jsonb_typeof(v_category -> 'approvalReference') <> 'string'
    or jsonb_typeof(v_category -> 'validUntil') <> 'string' then
    raise exception 'Approval validity policy is invalid.' using errcode = '22023';
  end if;

  v_reference := btrim(v_category ->> 'approvalReference');
  if char_length(v_reference) < 3
    or char_length(v_reference) > 200
    or v_reference ~* '^(n/?a|tbd|todo|placeholder|owner input required|x{2,}|-+)$' then
    raise exception 'Approval validity policy needs a valid approval reference.' using errcode = '22023';
  end if;

  v_valid_until_text := v_category ->> 'validUntil';
  if v_valid_until_text !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$' then
    raise exception 'Approval validity policy must use an ISO UTC expiry.' using errcode = '22023';
  end if;
  begin
    v_valid_until := v_valid_until_text::timestamptz;
  exception when others then
    raise exception 'Approval validity policy has an invalid expiry.' using errcode = '22023';
  end;
  -- PostgreSQL accepts a few ISO-shaped values by normalising them (for
  -- example 24:00). Round-trip the exact supported UTC representation so an
  -- impossible calendar/time value cannot be persisted through the RPC.
  v_canonical_valid_until := to_char(
    v_valid_until at time zone 'utc',
    'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
  );
  if v_valid_until_text !~ '\.\d{3}Z$' then
    v_canonical_valid_until := regexp_replace(v_canonical_valid_until, '\.000Z$', 'Z');
  end if;
  if v_canonical_valid_until <> v_valid_until_text then
    raise exception 'Approval validity policy has an invalid expiry.' using errcode = '22023';
  end if;
  if v_valid_until <= clock_timestamp() then
    raise exception 'Approval validity policy must expire in the future.' using errcode = '22023';
  end if;

  -- Serialise only this protected key's writer. A SELECT ... FOR UPDATE cannot
  -- lock an absent first row, so without this transaction-scoped advisory lock
  -- two first writes could both audit before_data as NULL. This lock releases at
  -- transaction end and does not change unrelated platform_settings access.
  -- The local PGlite harness is single-connection, so release review must also
  -- run a real multi-connection PostgreSQL concurrency test for this guarantee.
  perform pg_advisory_xact_lock(hashtext('public.ordering_launch_readiness')::bigint);

  select value into v_before
  from public.platform_settings
  where key = 'ordering_launch_readiness'
  for update;

  v_recorded_at := to_char(clock_timestamp() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  v_value := p_approvals || jsonb_build_object(
    'schemaVersion', 1,
    'recordedAt', v_recorded_at,
    'recordedBy', v_actor_id
  );

  insert into public.platform_settings (key, value, description, updated_by, updated_at)
  values (
    'ordering_launch_readiness',
    v_value,
    'Owner-recorded launch approvals required before order creation',
    v_actor_id,
    clock_timestamp()
  )
  on conflict (key) do update set
    value = excluded.value,
    description = excluded.description,
    updated_by = excluded.updated_by,
    updated_at = excluded.updated_at;

  insert into public.super_admin_audit_logs (
    actor_id,
    target_id,
    action,
    before_data,
    after_data,
    reason
  ) values (
    v_actor_id,
    null,
    'SETTING_CHANGED',
    v_before,
    v_value,
    coalesce(nullif(btrim(p_reason), ''), 'Recorded ordering launch-readiness approvals')
  );
end;
$$;

revoke all on function public.record_ordering_launch_readiness(jsonb, text) from public, anon, authenticated, service_role;
grant execute on function public.record_ordering_launch_readiness(jsonb, text) to authenticated;

comment on function public.record_ordering_launch_readiness(jsonb, text) is
  'Authenticated Super Admin-only atomic writer for ordering launch readiness and its audit event. It stamps actor/time server-side and rolls back the setting if audit insertion fails.';
