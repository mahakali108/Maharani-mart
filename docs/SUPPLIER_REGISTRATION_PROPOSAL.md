# Supplier Registration & Super Admin Approval — Proposal (NOT APPLIED)

Status: **owner decisions received 2026-10-17** (Admin + Super Admin may
review; application-only V1, no supplier login/role; documents uploaded by
Maharani reviewers to private storage; applicants cannot upload).
Implemented: migration file `supabase/migrations/0059_supplier_applications.sql`
(+ rollback), public `/register-supplier` form, `/admin/suppliers/applications`
review queue, and DB/unit regression tests.
**Migration 0059 has NOT been applied to any Supabase project** — no target
project is configured in this checkout (no `.env.local`; see the BLOCKED
note in the session report), so production verification, backup/recovery
and application remain outstanding.
The draft below was corrected during implementation against the approved
decisions (review = admin-or-above, definer submission function, private
bucket); the migration file is authoritative.

## Verified current state (2026-10-17, branch `arena/851511a1-maharani-mart`)

- No `suppliers` / `supplier_applications` table in migrations 0001–0058.
- `user_role` enum = `super_admin, admin, staff, salesman, retailer` — **no
  supplier role**, and `lib/auth/roles.ts` has no supplier route prefix.
- Supplier Directory (`/admin/suppliers`, commit on this branch) is
  GRN-derived only; `grns.supplier_reference` is free text.
- Reusable precedents that DO exist:
  - Retailer registration → `pending_approval` → admin approval
    (`register-retailer`, `approveRetailerAction`, `retailer_status` enum).
  - Private document storage: `retailer-documents` bucket (public = false,
    staff-read / owner-folder policies, 0006) and `retailer_documents` table.
  - RLS helpers `is_staff_or_above()` / `is_admin_or_above()` (0001),
    audit triggers (`log_audit()`), `super_admin_audit_logs` (0020).
  - PGlite DB test harness (`tests/helpers/pg-harness.ts`) used by existing
    `*-db.test.ts` suites — the right vehicle for RLS regression tests.

## Decisions required from the owner before implementation

1. **Who may approve?** DECIDED (owner, 2026-10-17): **Admin and Super
   Admin** may review (`suppliers.review`, admin + super_admin), enforced
   in the server action, RLS, and the 0059 review-enforcement trigger.
2. **Account model:** (a) application-only (business applies without a
   login; staff contact them offline; an approved record becomes a supplier
   master row, still no login), or (b) full supplier login (new
   `supplier` role + profile linkage + route prefix + mobile/session
   impact). **(a) is recommended first** — (b) is a much larger auth/RLS
   surface and must not be bundled silently.
3. **Documents:** anonymous applicants uploading KYC files is an abuse and
   malware vector. Recommended v1, mirroring retailer Phase 2A: applicants
   submit details only; **documents are uploaded by staff after first
   contact**, into a private `supplier-documents` bucket (public = false,
   signed-URL access only, 10 MB, png/jpg/webp/pdf). Public/anon upload can
   be a separately reviewed phase.
4. **GSTIN:** optional free-text field, format-checked (15-char pattern)
   only when provided, stored as *applicant-declared*, and never displayed
   as "verified". No GSTIN verification service exists in the repo.
5. **Duplicate handling:** same phone/email re-applying — recommended:
   reject a second application while one is `pending`, allow re-apply after
   `rejected`. Enforced by a partial unique index (see draft).
6. **Link to GRNs:** keep legacy `grns.supplier_reference` untouched.
   Optional nullable `grns.supplier_id` backfill is a *separate* later
   migration, done by human matching only — never fuzzy auto-matching.

## Proposed migration (draft — `0059_supplier_applications.sql`, do not apply)

```sql
-- enum + master/application table (one table: an approved application IS
-- the supplier record; status carries the lifecycle)
create type supplier_application_status as enum
  ('pending','approved','rejected','suspended');

create table suppliers (
  id uuid primary key default uuid_generate_v4(),
  business_name text not null check (char_length(btrim(business_name)) between 2 and 120),
  legal_name text,                       -- applicant-declared, never auto-filled
  contact_name text not null check (char_length(btrim(contact_name)) between 2 and 80),
  phone text not null check (phone ~ '^[6-9][0-9]{9}$'),   -- Indian mobile, as elsewhere
  email text check (email is null or email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  address_line text, city text, state text,
  pincode text check (pincode is null or pincode ~ '^[0-9]{6}$'),
  gstin text check (gstin is null or gstin ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$'),
      -- applicant-declared only; gstin_verified stays false until a human
      -- checks documents — no code path may set it automatically
  gstin_verified boolean not null default false,
  product_categories text,               -- free text summary of what they supply
  status supplier_application_status not null default 'pending',
  rejection_reason text,
  reviewed_by uuid references profiles(id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- one live application per phone
create unique index uq_suppliers_pending_phone on suppliers (phone)
  where status = 'pending';

create table supplier_documents (
  id uuid primary key default uuid_generate_v4(),
  supplier_id uuid not null references suppliers(id) on delete cascade,
  doc_type text not null,
  file_url text not null,                -- storage path, NOT a public URL
  file_name text not null,
  uploaded_by uuid references profiles(id),
  created_at timestamptz not null default now()
);

alter table suppliers enable row level security;
alter table supplier_documents enable row level security;

-- No anon/authenticated direct access at all: applications are submitted
-- through a validated, rate-limited server endpoint (see below) and read
-- only by admin-or-above through RLS.
create policy "suppliers_admin_read" on suppliers
  for select using (is_admin_or_above());
-- status transitions only by super_admin (approval gate); enforced again
-- in the Server Action via suppliers.review (defense in depth)
create policy "suppliers_super_admin_update" on suppliers
  for update using (
    exists (select 1 from profiles p
            where p.id = auth.uid() and p.role = 'super_admin' and p.is_active)
  );
create policy "supplier_documents_admin_read" on supplier_documents
  for select using (is_admin_or_above());
create policy "supplier_documents_staff_write" on supplier_documents
  for insert with check (is_staff_or_above());

create trigger trg_audit_suppliers after insert or update or delete on suppliers
  for each row execute function log_audit();
-- + private storage bucket 'supplier-documents' copied from the
--   retailer-documents pattern (public=false, staff read/write, no anon).
```

Submission path: a Server Action / route handler that validates with the
same zod-style rules as the form, inserts via a narrowly-scoped
`SECURITY DEFINER` function `submit_supplier_application(...)` (fixed
search_path, `status` forced to `'pending'`, no caller control over
`reviewed_*`/`gstin_verified`), with per-IP/phone throttling reusing the
existing rate-limit approach. Direct table INSERT is never granted.
(This function must pass the existing `security-definer-hardening` test
conventions.)

## App work implemented locally (live only after migration 0059 is applied to a verified target)

- `lib/admin/supplier-applications.ts` (pure validation — GSTIN/phone/pin
  patterns, length bounds), `suppliers.review` permission (super_admin
  only), public `/register-supplier` form (loading/error/success states,
  honeypot + throttle), `/admin/suppliers/applications` review queue
  (pending list, approve/reject with reason, audit-visible), signed-URL
  document viewing for admin+.
- Explicitly out of scope: supplier login/portal, supplier-owned
  inventory, marketplace selling, commissions, settlements, linking GRNs.

## Regression tests to add with the implementation (not written yet)

1. Permission matrix: `suppliers.review` held by super_admin only.
2. Validation unit tests: bad phone/GSTIN/pincode, oversized fields,
   status-forgery attempts rejected.
3. PGlite DB tests: anon cannot select/insert `suppliers`; admin can read
   but cannot approve; super_admin can approve/reject; duplicate pending
   phone rejected; `gstin_verified` cannot be set by submission.
4. Isolation: supplier document paths are private (no public bucket read),
   signed URL required; one applicant cannot read another's record (no
   applicant read path exists at all in v1).
5. Page-guard consistency + server-action surface suites must stay green.

## Next step

Owner replies approving (a) this migration draft, (b) decisions 1–3 above,
and (c) applying migration 0059 to the target Supabase project. Only then
is the registration + approval UI implemented and tested end-to-end.
 (c) applying migration 0059 to the target Supabase project. Only then
is the registration + approval UI implemented and tested end-to-end.

## Duplicate-approved policy (audit Fix 3)

Phone/email are contact details, not a proven business identity (shared
accountant emails, multiple branches, changed numbers), so **no unique
index is imposed on approved suppliers**. Policy instead:
- duplicate *pending* applications stay blocked (partial unique indexes);
- *rejected* applications may reapply;
- the review detail page shows a non-blocking "possible duplicate" warning
  (same phone/email/GSTIN) for a human to compare.
Preventing duplicate *approved* records outright requires an owner-
confirmed identity key (e.g. GSTIN for GST-registered suppliers only) and
a separate migration — not imposed unilaterally.

## Document lifecycle (V1)

Upload only. There is **no document deletion** in V1 — not in the UI, not
via server actions, not via API grants — so the verification record stays
auditable. Removal, if ever needed, is an operator procedure under the
retention policy, paired with the guarded rollback's storage-backup rules.

## Spam protection (hardened locally)

F1–F7 audit follow-ups implemented locally (see
`lib/admin/supplier-rate-limit.ts` header for the full design):
- **F1 PARTIALLY MITIGATED:** bucket keys are now HMAC-SHA-256 under a
  server-only secret (`SUPPLIER_RATE_LIMIT_SECRET`, >= 32 chars; fallback:
  domain-separated derivation from SUPABASE_SERVICE_ROLE_KEY, mirroring
  the delivery-OTP precedent). **Owner action at deployment:** provision
  `SUPPLIER_RATE_LIMIT_SECRET` in the server environment only. Rotating
  it invalidates existing rate-limit buckets (counters restart) — no
  dual-key compatibility is implemented. Without any secret the code
  never uses predictable hashes: submissions rely on the bounded
  in-memory fallback until a secret is configured. A dedicated secret
  that is configured but INVALID (< 32 chars) is different from an
  absent one: it does NOT silently fall back to the service-role-derived
  key (audit N4) — durable limiting is disabled, a throttled
  identifier-free configuration warning is logged, and the bounded
  in-memory fallback applies until the configuration is fixed. Residual: anon can
  create counter rows under invented keys any more (see N1 above —
  EXECUTE is service_role-only); they cannot compute a real supplier's
  bucket without the secret.
- **N1 FIXED locally (trust boundary):** the limiter RPC is now an
  internal server-only mechanism — migration 0060 revokes EXECUTE from
  PUBLIC, anon and authenticated and grants it only to `service_role`;
  the submission action calls it via `createServiceRoleClient()` while
  the public `submit_supplier_application` RPC (0059) stays on the
  ordinary anon-context path. Direct anonymous RPC calls with invented
  key hashes are denied before any mutation. This closes the
  invented-key row-creation bypass; it is distinct from retention:
- **F2 residual owner action (retention, not abuse prevention):** when
  applying migration 0060, add `supplier_application_rate_limits` to
  the periodic retention cleanup (rows older than 7 days) — concretely
  this needs a FUTURE separately-authorized migration that adds a
  `data_retention_rules` row AND a hard-coded engine branch in
  `run_data_cleanup` (migration 0055's registry alone does nothing
  without its engine implementation, and 0055 may already be applied
  in production, so editing 0055 locally would not reach it). The
  function also opportunistically deletes at most 100 expired rows per
  bucket per call. No schedule is assumed
  to exist until the owner wires one.
- F3 bounded in-memory fallback (10k entries, LRU eviction — a
  still-active key evicted under memory pressure regains a fresh
  window, an accepted bounded-memory trade-off; incremental expiry
  sweep of at most 64 records per request, audit N2/N3); F4 counter
  capped at limit+1; F5 RPC payload shape validation; F6 warnings
  throttled to 1/minute; F7 client bucket checked before phone quota
  (non-transactional; one client token may be consumed on phone reject).

## Spam protection (original design, superseded in part above)

Submissions are rate-limited server-side in `lib/admin/supplier-rate-limit.ts`:
a durable, atomic Postgres limiter (unapplied migration 0060, hash-keyed —
raw phone/IP never stored) with a 3/10-min phone bucket and a best-effort
10/hour client-identity bucket, falling back to the previous in-memory
limiter if the RPC is unavailable. The client identity is the platform-set
first `X-Forwarded-For` hop, hashed, and used only as an extra bucket —
never as a trusted identity. This raises the cost of repeat/rotation
abuse; it does not defeat distributed abuse, and multi-instance
durability exists only once migration 0060 is applied to a verified
target (currently NOT applied anywhere).
