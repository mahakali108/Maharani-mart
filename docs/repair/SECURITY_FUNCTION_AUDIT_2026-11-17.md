# Security Function Audit — 2026-11-17 (PR #137 completion pass)

**Method:** static review of the authoritative definitions in
`supabase/migrations/` (the final `create or replace` wins), caller review in
`app/`, `lib/`, and the PGlite PostgreSQL 16 suites
(`security-advisor-remediation-db`, `security-definer-hardening-db`,
`privilege-hardening-db`, `phase3-business-control-db`). Production history was
verified read-only through `0103`; no production object was modified.

**Scope note:** `SECURITY DEFINER` hygiene is enforced mechanically —
`tests/migration-catalog-invariants.test.ts` fails if any definer function
loses its pinned `search_path`, and `pr126-migration-review-db.test.ts` /
`security-advisor-remediation-db.test.ts` pin the live-advisor remediation
(search_path `pg_catalog, public, pg_temp`; trigger functions not
API-callable; four reporting views `security_invoker=true`).

---

## 1. The five named functions

### 1.1 `current_user_role()` — `returns user_role`
- **Definition:** 0052 (`select role from public.profiles where id = auth.uid() and is_active`), `STABLE SECURITY DEFINER`, `search_path = public`.
- **Anonymous execution:** required — PUBLIC RLS policies evaluate it for anon; returns NULL without a session. **Authenticated:** required (RLS).
- **Authorization inside function:** n/a (returns only the caller's own role).
- **Leaks:** nothing — caller-scoped, NULL for anon. **Rate limit:** not needed.
- **Callers:** RLS policies across the schema; `lib/admin/control-center/guard.ts` and Phase 3 server actions.

### 1.2 `is_admin_or_above()` — `returns boolean`
- **Definition:** 0052 (`coalesce(current_user_role() in ('super_admin','admin'), false)`), `STABLE SECURITY DEFINER`, `search_path = public`.
- **Anonymous execution:** required (policy predicate; returns `false` for anon). **Leaks:** nothing. **Rate limit:** not needed.
- **Callers:** RLS policies; admin/staff gates.

### 1.3 `can_current_staff_read_profile(uuid)` — `returns boolean`
- **Definition:** 0037, `STABLE SECURITY DEFINER`, `search_path = public, pg_temp`. True only when the target profile is staff/admin/salesman OR a retailer assigned to the caller's staff area scope.
- **Anonymous execution:** callable by anon only because PUBLIC policies reference it (documented exception in 0103); for anon `current_user_role() = 'staff'` is false at every call site, so it cannot widen anything.
- **Leaks:** no path to a caller — the boolean is consumed inside RLS, never returned to clients. Verified by `privilege-hardening-db` suites.
- **Callers:** `profiles` SELECT policy (0037) and staff-scoped policies.

### 1.4 `submit_supplier_application(11× text)` — `returns uuid`
- **Definition:** 0059; `SECURITY DEFINER`, `search_path = public, pg_temp`; granted to `anon, authenticated` (only public write path; forces `status='pending'`, no reviewer columns in signature).
- **Anonymous execution:** required (public supplier form). **Authorization:** insert-only, pending-only by construction.
- **Rate limiting:** YES, verified — 0060 `consume_supplier_application_rate_limit` (HMAC-SHA-256 bucket keys, `service_role`-only EXECUTE, RLS-locked table) is consumed server-side in `lib/admin/supplier-actions.ts` **before** the RPC, with generic non-enumerating error copy and a documented fail-open fallback.
- **Leaks:** none — no existence semantics returned. **Callers:** `lib/admin/supplier-actions.ts` (`/register-supplier`).

### 1.5 `is_phone_registered(text)` — `returns boolean`  ⚠ OPEN ITEM
- **Definition:** 0012, `STABLE SECURITY DEFINER`, `search_path = public`; granted to `anon, authenticated`. **Confirmed** no later migration narrows the grant; 0057/0078/0103 each record the anon grant as a *deliberate, reviewed* exception.
- **Anonymous execution:** currently required by design — see callers.
- **Verified callers (complete list, 2026-11-17):**
  1. `app/api/mobile/v1/retailers/register/route.ts` — server-side, behind the per-instance IP token bucket `auth.login` (10 / 5 min).
  2. `lib/auth/actions.ts` `registerRetailerAction` — web registration server action; **no rate limit on this path today**.
  3. `lib/admin/team-actions.ts` — admin-only staff creation pre-check.
- **Leak:** yes, by contract — it is an existence oracle for phone numbers. Mitigations today: it returns a bare boolean (no other fields), uniqueness is enforced again inside `handle_new_user()`, and the mobile path is rate-limited.
- **Assessment:** enumerable at platform scale only via unauthenticated direct PostgREST calls with the public anon key. The DB trigger still guarantees uniqueness, so this is a privacy concern, not an integrity one.

#### Privacy-preserving replacement — DESIGNED, deliberately NOT shipped in PR #137
Three prior migrations explicitly deferred this to a dedicated review, and the
registration/login flows are the worst possible place for an unrequested
behaviour change on a final-approval branch. The design is recorded here for
the owner; implementation is one small migration + two call-site edits:

1. New migration: `revoke execute on function public.is_phone_registered(text) from anon;` keep `authenticated` (attributable) or move both server flows to a service-role client and revoke `authenticated` too.
2. `registerRetailerAction` and the mobile register route switch the pre-check to the existing `createServiceRoleClient` / `createMobileServiceRoleClient` helpers, failing **open** to `signUp()` on any check error (the DB trigger remains the authoritative uniqueness gate), and consuming a server-side per-client bucket first (reuse the 0060 HMAC limiter pattern for a global, non-per-instance cap).
3. Regression tests: anon gets `42501`; web + mobile registration still return the same duplicate-phone UX; fail-open path proven by forcing a pre-check error.

**Owner decision required:** accept the documented oracle, or schedule the
above as its own small PR. Do not ship it inside Phase 3.

---

## 2. Other externally executable `SECURITY DEFINER` functions

- **0109 additions:** `get_retailer_membership_overview(uuid)` — self-or-admin check inside (`auth.uid() <> p_retailer_id and not is_admin_or_above()` → `42501`); granted to `authenticated` only. `super_admin_assign_membership(...)` — `super_admin` only, program gate + owner reference; granted to `authenticated` (defence in depth: role check inside).
- **Trigger functions (0103):** the 12 row-trigger functions and `rls_auto_enable()` have EXECUTE revoked from `public/anon/authenticated` — verified by `security-advisor-remediation-db.test.ts`.
- **0093/0094/0099–0101 wallet/loyalty/delivery RPCs:** SECURITY DEFINER with pinned search_path and role guards; covered by their dedicated DB suites.

## 3. RLS verification highlights (all machine-tested)

- Retailers: cross-tenant profile/order/wallet/membership reads denied; role self-escalation blocked (`phase3-business-control-db` §6); seller self-approval blocked (§1).
- Sellers: cannot self-approve offers where approval is required, cannot touch other sellers' rows, wholesale discount/MOQ ceilings enforced by `AFTER` triggers server-side (§3).
- `products.cost_price`: column lockdown (0025/0107) preserved — only via SECURITY DEFINER helpers; `products.description` exposed via column-level grant without reopening cost_price (§2).
- `super_admin_audit_logs` / `seller_ad_campaign_audit` / `product_moderation_history`: append-only, actor-pinned (§5–6).
- Anonymous reads fail closed across Phase 3 governance tables (§6; 0102 policies).

**Result:** no new security defect found in this pass; one pre-existing,
documented privacy item (`is_phone_registered` anon oracle) carried as an
owner decision with a ready design (§1.5).
