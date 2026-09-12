# Production Verification Checklist — Phase 4 (Order lifecycle, deliveries & collections)

> Status of this document: **written, not yet executed against a live project.**
> The build sandbox has no Supabase credentials, no `psql`/`supabase` CLI and no
> outbound network route to a Supabase project, so the live steps below have
> **not** been run. Do not treat Phase 4 as production-ready until every box in
> §5 and §6 is checked off against the real project.
>
> Everything statically verifiable in CI is already green:
> `pnpm typecheck` ✓ · `pnpm lint` (0 errors) ✓ · `pnpm build` (103 pages) ✓ ·
> `pnpm test` (899 tests / 48 files) ✓.

## 0. Live status (updated 2026-09-12)

| Step | Status |
|------|--------|
| Migrations 0037–0045 applied to the live project | ⏳ **NOT DONE — owner action required** (probe + one-command apply: `scripts/production-validate.sh`) |
| `supabase/smoke-test.sql` executed | ⏳ NOT DONE — runs as part of the script above, or standalone via `psql "$DATABASE_URL" -f supabase/smoke-test.sql` |
| Real-account role testing (§5) | ⏳ NOT DONE — requires the owner's accounts |
| Dispatch→delivery→collection flow (§6) | ⏳ NOT DONE |
| Private-URL cross-user denial (§3 HTTP checks) | ⏳ NOT DONE |
| Vercel deployment | ✅ **Preview deployed & Ready** for PR #54: `https://maharanitraders-git-arena-01a0914f-2c285b-mahakali108s-projects.vercel.app` (build `AoK6NK5XToA2UWskfxdLH3fqgyYF`). Vercel Deployment Protection (SSO) is ON — open it while logged into the team's Vercel account. **Production is untouched** (PR #54 is open, NOT merged; production still runs `main`). |
| Real-device testing | ⏳ NOT DONE — physically requires the owner's devices |

**Important sequencing:** the preview deployment shares the production Supabase
project. Until migrations 0037–0045 are applied, the new pages
(`/admin/delivered`, `/admin/collections`, `/staff/deliveries`,
`/salesman/deliveries`, `/salesman/collections`) and the dispatch flow on the
PREVIEW will error — apply migrations first, then test. The production
deployment (main) is unaffected because it runs the old code.

---

## 1. Migration application order (exact)

Migrations run in lexicographic filename order — which is also the required
dependency order. **Apply with `supabase db push`** (or `psql -f` in this
order) against the target project:

| # | File | Depends on | What it creates |
|---|------|-----------|-----------------|
| 1 | `supabase/migrations/0042_order_state_machine.sql` | 0001 (`orders`) | `enforce_order_status_transitions()` + `trg_enforce_order_status_transitions` on `orders` |
| 2 | `supabase/migrations/0043_deliveries_module.sql` | 0001 (`current_user_role`, `is_admin_or_above`, `log_audit`), 0014 (`is_retailer_assigned_to_current_salesman`), 0037 (`is_order_assigned_to_current_staff`) | `order_deliveries`, `order_delivery_items`, `can_current_user_view_delivery()`, RLS policies, `enforce_delivery_status_transitions()` + trigger, audit triggers |
| 3 | `supabase/migrations/0044_payment_collections.sql` | 0001 helpers, `retailers`, `orders` | `payment_collections`, RLS policies, audit trigger |
| 4 | `supabase/migrations/0045_delivery_payment_proof_buckets.sql` | **0043 + 0044** (its storage policies query `order_deliveries` / `payment_collections`) | private buckets `delivery-proofs` + `payment-proofs` and their storage policies |

Rules that MUST hold:

- **0045 must run last** — its `storage.objects` policies reference the tables
  created by 0043/0044; applying it first fails with `relation "order_deliveries" does not exist`.
- 0042–0044 have no dependency on each other, but keep the lexicographic
  order — the migration runner enforces it and the test-suite assertions
  assume it.
- All four are **additive and re-runnable** (`create or replace`, `drop … if
  exists`, `insert … on conflict do update`). Zero `drop table` / `drop column`
  / `truncate` / `delete from` statements. No business data is inserted.
- If 0037–0041 are not yet applied to the target, they must be applied first
  (0043 calls the 0037 helper directly).

### Post-application verification SQL (run as postgres / in the SQL editor)

```sql
-- All four migrations landed:
select proname from pg_proc where proname in
  ('enforce_order_status_transitions','enforce_delivery_status_transitions',
   'can_current_user_view_delivery');
-- expect: 3 rows

select tgname from pg_trigger where tgname in
  ('trg_enforce_order_status_transitions','trg_enforce_delivery_status_transitions',
   'trg_audit_order_deliveries','trg_audit_order_delivery_items','trg_audit_payment_collections')
  and not tgisinternal;
-- expect: 5 rows

select id, public, file_size_limit from storage.buckets
  where id in ('delivery-proofs','payment-proofs');
-- expect: 2 rows, public = false for both

select count(*) from pg_policies where schemaname='public'
  and tablename in ('order_deliveries','order_delivery_items','payment_collections');
-- expect: 10 policies (3 + 5 + 2)

select count(*) from pg_policies where schemaname='storage' and tablename='objects'
  and policyname like '%proof%';
-- expect: 4 policies
```

---

## 2. RLS verification matrix (run as each role)

The script `supabase/smoke-test.sql` automates every row of this matrix using
**real profiles already in the database** and rolls everything back — run it
with:

```
psql "$DATABASE_URL" -f supabase/smoke-test.sql
```

Expected output is a series of `PASS:` notices and a final `SMOKE TEST COMPLETE`
with `ROLLBACK` (no data is left behind). What it asserts:

| Role | Must be able to | Must NOT be able to |
|------|-----------------|---------------------|
| admin / super_admin | see all deliveries, all collections; update/verify them | — (full access by design) |
| staff | see/touch deliveries only within their assigned warehouse/area scope or where `assigned_staff_id = auth.uid()`; insert delivery tasks on dispatch for in-scope orders | see deliveries in other areas; delete any delivery row; insert a collection for an unassigned retailer |
| salesman | see deliveries where they are the assignee / collected the order / own the retailer; insert collections **only** for retailers assigned to them | verify/reject collections; update any delivery; see other salesmen's retailers' collections |
| retailer | read own orders' deliveries and collections | insert/update/delete `order_deliveries`, `order_delivery_items`, `payment_collections`; update `orders.status` to anything except the legal self-cancel of a `pending` order |
| anon | nothing | no select on any Phase 4 table |

Illegal delivery-status jumps that the DB trigger must reject (also asserted in
the script): `delivered → failed`, `delivered → assigned`, `failed → delivered`,
`returned_to_warehouse → *`, `partially_delivered → delivered`,
`assigned → returned_to_warehouse`; plus the order-machine rejects
`pending → delivered`, `cancelled → *`, `delivered → dispatched`.

---

## 3. Private-bucket verification (run after migrations)

```sql
-- Buckets are private:
select public from storage.buckets where id in ('delivery-proofs','payment-proofs');
-- expect: f, f

-- No public-read policy exists on them:
select policyname, cmd from pg_policies
  where schemaname='storage' and tablename='objects'
  and policyname like '%proof%';
-- expect exactly 4 rows, all cmd in ('SELECT','INSERT') with owner-bound USING/CHECK
```

HTTP checks (from any machine with network access to the project):

```bash
# 1) Public/object URL must NOT serve the file (private bucket):
curl -s -o /dev/null -w '%{http_code}\n' \
  "https://<PROJECT>.supabase.co/storage/v1/object/public/delivery-proofs/delivers/<orderId>/<file>.webp"
# expect: 400 or 403 — never 200

# 2) Signed URL fetched by the OWNING retailer session must return 200
#    (do this in the app: open the order's Delivery record page as that
#    retailer — the signature/photo <img> tags must render).

# 3) The same signed URL fetched by ANOTHER retailer (copy the URL into an
#    incognito window) must return 403 — signature binding proves ownership.
```

Code-side guarantees (already enforced by tests, restated for the audit trail):
uploads go through `uploadMedia('delivery-proof' | 'payment-proof')`, which is
the only write path and can never mint a public URL for a private kind
(`lib/media/supabase.ts`: `ref = config.private ? path : publicUrl`); reads go
through `resolveProofUrl → getSignedUrl` only.

---

## 4. Delivery-transition verification

Covered by `supabase/smoke-test.sql` (§ C) with live `UPDATE … USING` attempts
under each role. Additionally confirm in the app UI:

1. A `delivered` order's admin page offers **Return to warehouse** (not
   "fail delivery").
2. A `failed` delivery shows the re-attempt banner and the order is back in
   the staff dispatch queue (`processing`).
3. `requestReturnAction` on the retailer side rejects with the closed-window
   message once `return_deadline` has passed.

---

## 5. Live role smoke-test plan (per role, in the app)

Prerequisites: one real account per role (super_admin or admin, staff with an
area/warehouse assignment, salesman with ≥1 assigned retailer, that retailer).
Use only real orders; the smoke script's throwaway rows are rolled back.

**Admin**
- [ ] `/admin/orders` — approve a pending order (status → `confirmed`)
- [ ] Assign a warehouse, then `/staff`-equivalent dispatch is done by staff below;
      admin can also dispatch from the order page
- [ ] `/admin/delivered` — filter by outcome/delivery person/date; export CSV opens
- [ ] `/admin/delivered/[orderId]` — receiver, OTP verified, per-line delivered/
      missing/damaged, financials card shows the shortfall credit, proof images render
- [ ] `/admin/orders/[id]` — Delivery control: reassign staff, resend OTP, confirm
      return-to-warehouse on a delivered order (stock movements + wallet reversal
      appear in the ledger)
- [ ] `/admin/collections` — pending queue shows the salesman's collection; verify
      credits the wallet exactly once (double-click verify stays single);
      reject credits nothing

**Staff (assigned to area/warehouse X)**
- [ ] `/staff/orders` — pick/pack an order, then dispatch
- [ ] Dispatch creates exactly one delivery task; the retailer notification
      contains the 6-digit OTP
- [ ] `/staff/deliveries` — the task appears under "My deliveries" (assigned to the
      dispatcher by default)
- [ ] Open the task: address snapshot, lines with ordered quantities; Start delivery
- [ ] Complete with a wrong OTP → error + attempt counter increments (locks at 10)
- [ ] Complete with the right OTP, one line short → order becomes `delivered`,
      delivery status `partially_delivered`, shortfall REFUND_CREDIT row in the
      retailer ledger
- [ ] "Could not deliver" with a reason on another dispatched order → order back to
      `processing`, task `failed`; re-dispatch resets the same task (no duplicate)
- [ ] Confirm the staff account CANNOT see deliveries for orders outside its
      assigned area (open a direct URL to an out-of-scope delivery → not found)

**Salesman (assigned to retailer R)**
- [ ] `/salesman/deliveries` — only deliveries assigned to them / collected by them /
      R's orders appear
- [ ] `/salesman/collections` — record a cash collection for R with a photo proof;
      it lands as `pending`; R's wallet does NOT change yet
- [ ] Recording a collection for a retailer NOT assigned to them → rejected
- [ ] After admin verification: R's ledger shows `PAYMENT_CREDIT` and the collection
      page shows `verified`

**Retailer (R)**
- [ ] Notification centre shows the OTP notification from dispatch
- [ ] `/retailer/orders/[id]/delivery` — read-only record: who delivered, receiver,
      OTP verified, delivered/missing/damaged per line, proof images render,
      return window text, reorder link works
- [ ] Inside the return window: return request from the order page is accepted;
      after the deadline (or by temporarily setting `return_deadline` to yesterday
      in a rolled-back transaction): rejected with the closed-window message
- [ ] R cannot reach `/admin/*`, `/staff/*`, `/salesman/*` (middleware redirect) and
      has no delivery/collection write actions anywhere in the retailer app

## 6. End-to-end flow verification (dispatch → task → assignment → completion → collection)

Run once with real accounts, checking DB state after each step with the SQL in
`supabase/smoke-test.sql` § D:

1. **Dispatch** (staff): order `confirmed → dispatched`;
   `order_deliveries` gains exactly ONE row (`delivery_status='assigned'`,
   `assigned_staff_id` = dispatcher, `otp_hash` set, plain OTP only in the
   retailer's notification); `order_delivery_items` snapshot rows = order lines;
   stock consumed via `consume_order_stock`.
2. **Assignment** (admin): reassign to the salesman;
   `assigned_staff_id`/`assigned_at`/`assigned_by` update; salesman gets a
   notification; old assignee loses execute rights (pre-check in
   `completeDeliveryAction`).
3. **Completion** (salesman): OTP from the retailer, receiver name, one line short;
   task → `partially_delivered`, `otp_verified_at` set, `return_window_days` +
   `return_deadline` snapshotted; order → `delivered`; ledger gains
   `REFUND_CREDIT` (idempotency key `delivery-shortfall:<deliveryId>`);
   proof objects exist under `deliveries/<orderId>/` in `delivery-proofs`.
4. **Collection** (salesman): `payment_collections` row `pending`, optional proof
   under `payments/<retailerId>/` in `payment-proofs`; wallet unchanged.
5. **Verification** (admin): status → `verified`, ledger gains `PAYMENT_CREDIT`
   (idempotency key `collection:<id>`), `ledger_entry_id` linked; re-running
   verify is a no-op.
6. **Audit trail**: `audit_logs` contains rows for the order status change,
   delivery insert + update, delivery-item update, and both collection changes.

---

## 7. Sign-off

- [ ] Migrations 0042–0045 applied in order; §1 verification SQL returns expected counts
- [ ] `supabase/smoke-test.sql` prints all `PASS:` lines and `SMOKE TEST COMPLETE`
- [ ] §3 private-bucket HTTP checks behave as specified
- [ ] Every box in §5 and §6 checked for all four roles
- [ ] `pnpm typecheck && pnpm lint && pnpm build && pnpm test` green on the release commit

Until all of the above are checked against the live project, **Phase 4 is not
production-ready**. No APK build is claimed or in scope.
