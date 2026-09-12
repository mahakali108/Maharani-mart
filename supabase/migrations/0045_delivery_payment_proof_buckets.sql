-- ============================================================================
-- 0045: Private proof buckets — delivery-proofs & payment-proofs (Phase 4)
--
-- WHY
-- ---
-- Delivery completion needs signature + photo proof (decision D6/D7), and
-- salesmen recording collections may attach a photo of the cheque/receipt.
-- These are PRIVATE by default (never public URLs) and are viewed only
-- through short-lived signed URLs (getSignedUrl), exactly like
-- retailer-documents (migration 0006).
--
-- PATH LAYOUT (matches lib/media/types.ts MEDIA_KIND_CONFIG folders)
-- ---
--   delivery-proofs:  deliveries/{orderId}/{uuid}.webp
--   payment-proofs:   payments/{retailerId}/{uuid}.webp
--
-- ACCESS
-- ---
--   delivery-proofs
--     read : admin+; the retailer of the order (only the two files linked
--            from THEIR delivery row); the assigned delivery staff/salesman;
--            the collecting salesman; the retailer's assigned salesman;
--            staff whose assignment covers the order
--            (mirrors can_current_user_view_delivery in 0043)
--     write: admin+; the assigned staff/salesman of that order's delivery
--            task (uploading proof at completion)
--   payment-proofs
--     read : admin+; the retailer (their payments/{retailerId}/ folder);
--            the collecting salesman (rows they recorded)
--     write: admin+; a salesman for a retailer assigned to them
--
-- No UPDATE/DELETE storage policies: proofs are append-only (every upload
-- mints a fresh UUID path with upsert:false, so nothing is ever overwritten
-- or removed through the app).
--
-- SAFETY: additive & re-runnable (bucket insert on conflict, policies
-- dropped + recreated). No existing bucket is touched.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Buckets (private — no public flag)
-- ----------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'delivery-proofs',
  'delivery-proofs',
  false,
  5242880, -- 5 MB
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'payment-proofs',
  'payment-proofs',
  false,
  5242880, -- 5 MB
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- ----------------------------------------------------------------------------
-- delivery-proofs policies
-- ----------------------------------------------------------------------------

drop policy if exists "delivery_proofs_bucket_read" on storage.objects;
create policy "delivery_proofs_bucket_read" on storage.objects
  for select using (
    bucket_id = 'delivery-proofs'
    and (
      is_admin_or_above()
      or exists (
        select 1
          from order_deliveries od
          join orders o on o.id = od.order_id
         where (od.signature_url = storage.objects.name or od.photo_url = storage.objects.name)
           and (
             o.retailer_id = auth.uid()
             or od.assigned_staff_id = auth.uid()
             or o.collected_by = auth.uid()
             or is_retailer_assigned_to_current_salesman(o.retailer_id)
             or (current_user_role() = 'staff' and is_order_assigned_to_current_staff(o.id))
           )
      )
    )
  );

drop policy if exists "delivery_proofs_bucket_write" on storage.objects;
create policy "delivery_proofs_bucket_write" on storage.objects
  for insert with check (
    bucket_id = 'delivery-proofs'
    and (
      is_admin_or_above()
      or exists (
        select 1
          from order_deliveries od
         where od.order_id::text = split_part(storage.objects.name, '/', 2)
           and od.assigned_staff_id = auth.uid()
      )
    )
  );

-- ----------------------------------------------------------------------------
-- payment-proofs policies
-- ----------------------------------------------------------------------------

-- Object paths inside this bucket are `payments/{retailerId}/{uuid}.webp`,
-- so storage.foldername(name) is {payments, retailerId}: the retailer id is
-- segment [2], NOT [1] ([1] is the literal 'payments' — comparing or
-- casting it as a UUID breaks every read and raises
-- `invalid input syntax for type uuid: "payments"` on every write).
drop policy if exists "payment_proofs_bucket_read" on storage.objects;
create policy "payment_proofs_bucket_read" on storage.objects
  for select using (
    bucket_id = 'payment-proofs'
    and (
      is_admin_or_above()
      or (
        (storage.foldername(name))[1] = 'payments'
        and (storage.foldername(name))[2] = auth.uid()::text
      )
      or exists (
        select 1
          from payment_collections pc
         where pc.proof_url = storage.objects.name
           and pc.collected_by = auth.uid()
      )
    )
  );

drop policy if exists "payment_proofs_bucket_write" on storage.objects;
create policy "payment_proofs_bucket_write" on storage.objects
  for insert with check (
    bucket_id = 'payment-proofs'
    and (
      is_admin_or_above()
      or (
        current_user_role() = 'salesman'
        and (storage.foldername(name))[1] = 'payments'
        -- The folder segment must be a well-formed UUID before casting: a
        -- CASE (not a bare AND — Postgres may reorder AND branches) turns a
        -- crafted path into a clean policy denial instead of a uuid cast
        -- error that aborts the statement.
        and case
          when (storage.foldername(name))[2]
                 ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
          then is_retailer_assigned_to_current_salesman((storage.foldername(name))[2]::uuid)
          else false
        end
      )
    )
  );

-- ============================================================================
-- END OF MIGRATION — no business data inserted.
-- ============================================================================
