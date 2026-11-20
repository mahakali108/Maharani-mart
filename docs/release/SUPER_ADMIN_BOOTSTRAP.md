# First Super Admin — bootstrap procedure

**Status: procedure authored, tested and NOT executed.** Migration
`0106_first_super_admin_bootstrap.sql` is written and covered by
`tests/super-admin-bootstrap-db.test.ts` (10 tests, PostgreSQL 16). It has not been
applied to `fhrmsrumsraprvutrpeo`, and no account, profile or allowlist row has been
created anywhere.

---

## 1. Why a procedure is needed at all

Verified read-only on 16 November 2026: the live project has **0 rows in
`auth.users`**, **0 rows in `profiles`** and therefore **0 Super Admins**.
`is_super_admin()` reads `profiles.role`, so every privileged surface is
unreachable:

| Surface | Requires | State today |
|---|---|---|
| `/admin/content` and the whole admin area | `profiles.role` ∈ {super_admin, admin, …} | unreachable |
| `publish_site_page()`, `publish_legal_document_version()` | `is_super_admin()` | uncallable |
| Team invitations, seller invitations | an existing Super Admin | impossible |
| Stage-1 / stage-2 publication | a human running SQL | **the only working path** |

Without this procedure the first account would be created by an ad-hoc
`update public.profiles set role = 'super_admin'` with no record of who authorised
it, no evidence that the address was verified, and no guard against doing it twice.

---

## 2. What already protects the role (verified in this repository)

| Control | Where | What it prevents |
|---|---|---|
| `handle_new_user()` ignores a client-supplied `role`; role comes from server-side `staff_account_invites` / `seller_account_invites`, otherwise `retailer`; a non-retailer `account_type` raises `seller_invite_required` | `0072` | a public signup claiming `super_admin` through `signUp({ data: { role } })` |
| `guard_profile_privileged_columns()` refuses a role or `is_active` change from `anon`/`authenticated` unless the caller is already a Super Admin | `0052` | a retailer promoting themselves with an `update profiles` call |
| `profiles_self_update` policy is scoped to the caller's own row, and the guard trigger still applies | `0052` | editing anyone else's profile |
| RLS on `profiles` with `auth.uid()` scoping | `0001`/`0037`/`0052` | reading other people's rows |

So there is **no public path to Super Admin today**. The remaining gap is not
privilege escalation — it is the *legitimate first account*, which is
indistinguishable from an attacker's SQL unless it is written down and audited.

---

## 3. What migration 0106 adds

| Object | Purpose |
|---|---|
| `public.super_admin_bootstrap_allowlist` | exactly **one** row (`check (id = 1)`): the address, full name and phone of the person authorised to bootstrap. Written by the database owner in SQL. |
| `public.super_admin_bootstrap_events` | append-only evidence: profile id, email, previous role, `session_user`, timestamp, detail JSON. |
| `public.bootstrap_super_admin(uuid)` | `SECURITY DEFINER`, one-time, **no EXECUTE grant to `anon`, `authenticated` or `service_role`** — only the database owner in the SQL editor can run it. |
| `guard_profile_role_insert()` trigger on `profiles` | refuses an INSERT of a `super_admin`/`admin` profile from any API role, so a future policy change cannot reopen the insert path. |

### The six gates inside `bootstrap_super_admin()`

1. `session_user` must be `postgres`/`supabase_admin` — PostgREST connects as
   `authenticator`, so an API request can never satisfy this even if EXECUTE were
   granted by mistake.
2. **No Super Admin may exist.** A second call raises `23505`.
3. An allowlist row must exist and must not already be consumed (one-time).
4. The target `auth.users` row must exist and have `email_confirmed_at` set —
   an unverified address is not an owner identity.
5. `lower(auth.users.email)` must equal the allowlisted address, character for
   character (after trimming and lower-casing).
6. The `profiles` row must already exist (created by the auth trigger on signup),
   so the procedure can never conjure a login.

It then promotes the profile, sets `is_active = true`, repairs only a blank display
name, marks the allowlist row consumed, and writes one event row.

### Privileges (verified by execution, not by reading)

```
super_admin_bootstrap_allowlist : service_role → SELECT only
super_admin_bootstrap_events    : service_role → SELECT only
bootstrap_super_admin(uuid)     : postgres only  (anon/authenticated/service_role revoked)
guard_profile_role_insert()     : postgres only  (PUBLIC revoked, like 0078 did for handle_new_user)
```

A test asserts that `anon`, `authenticated` and `service_role` all get
`permission denied for function` when they call the bootstrap, and that neither API
role can insert into either table.

---

## 4. The procedure (owner-run, once)

> Nothing below has been run. Every statement is a proposal.

**Step 0 — decide who and enable the second factor.**
Choose the owner's own email address. In Supabase Dashboard → Authentication →
Providers, confirm email confirmation is ON (it is what gate 4 relies on), and turn
on MFA for the dashboard account that will run the SQL.

**Step 1 — apply 0106** (same channel as the other migrations; see
`docs/0104_0105_MIGRATION_AUDIT.md` §7). Applying it creates no account and
promotes nobody.

**Step 2 — create the login.** Either the owner registers through the app
(`/register`, which creates a `retailer` profile via the auth trigger) or you create
the user in Dashboard → Authentication → Users → *Add user* (email + password,
"Auto Confirm User" **off**, then click the confirmation link). Do not paste the
password anywhere else.

**Step 3 — register the authorisation, in SQL:**

```sql
insert into public.super_admin_bootstrap_allowlist (email, full_name, phone, note)
values ('owner@example.com', 'Owner Name', '8987023959',
        'Owner approval dated ____ (email/WhatsApp reference)')
on conflict (id) do nothing;

select * from public.super_admin_bootstrap_allowlist;
```

`email` must be lower-case, `phone` must be the 10-digit number (no `+91`), and the
row is the record of who authorised this. It can only ever hold one row.

**Step 4 — bootstrap, naming the account explicitly:**

```sql
-- find the id first; never guess it
select id, email, email_confirmed_at from auth.users where lower(email) = 'owner@example.com';

select public.bootstrap_super_admin('<that id>'::uuid);
```

Expected: no output; one event row; the allowlist row shows `consumed_at`.

**Step 5 — verify:**

```sql
select p.id, p.role, p.is_active, u.email, u.email_confirmed_at
  from public.profiles p join auth.users u on u.id = p.id
 where p.role = 'super_admin';

select profile_id, email, previous_role, session_role, occurred_at
  from public.super_admin_bootstrap_events order by occurred_at;

select id, email, consumed_at, consumed_profile_id, note
  from public.super_admin_bootstrap_allowlist;
```

Expected: exactly one `super_admin`, one event, one consumed allowlist row.

**Step 6 — sign in and confirm the gate:** `/admin/content` must open, and every
other account must be refused. A retailer logging in must still see the retailer
shell.

**Step 7 — add the second administrator through the product**, not through SQL:
`/admin/team` issues a staff invitation (`staff_account_invites`), and the invitee's
profile is created inside `handle_new_user()` — which is the supported path and the
one that leaves an audit trail. The bootstrap row stays consumed for ever.

### If the owner prefers not to add migration 0106

The equivalent manual action is:

```sql
update public.profiles set role = 'super_admin', is_active = true
 where id = (select id from auth.users where lower(email) = 'owner@example.com' and email_confirmed_at is not null);
```

It works, and it is what would happen anyway. It leaves **no evidence** of who
authorised it, it can be run again by anyone with SQL access, and nothing records
which address was verified. That is the whole reason 0106 exists; choosing the
manual path is a legitimate owner decision, and it should be recorded in
`docs/MIGRATION_APPLICATION_EVIDENCE.md` when it happens.

---

## 5. Threat model

| Attempt | Result |
|---|---|
| Public signup with `role: super_admin` in metadata | role ignored by `handle_new_user()`; account is a retailer; `seller_invite_required` if `account_type` is not retailer |
| Signed-in retailer calls `update profiles set role='super_admin'` | `guard_profile_privileged_columns()` raises `42501` |
| API caller inserts a `super_admin` profile | `guard_profile_role_insert()` raises `42501` |
| `service_role` key holder calls `bootstrap_super_admin()` | `permission denied for function` (no grant), and `session_user` would be `authenticator` anyway |
| Second call after a successful bootstrap | `A Super Admin already exists` |
| Re-using the allowlist row | refused: `consumed_at` is set |
| Bootstrapping someone else's account | refused: the address must equal the allowlist row |
| Bootstrapping an unconfirmed address | refused: `email_confirmed_at` is null |
| Reading the allowlist or the audit trail with the anon key | `permission denied` |

Residual risks, stated honestly:

* anyone who can run SQL in the project can drop 0106's trigger and do whatever
  they like — this procedure defends against accidents and API-level abuse, not
  against a compromised database owner;
* the owner's mailbox is the identity anchor. If the address is shared or
  compromised, the account is compromised: MFA and a private mailbox are part of
  the procedure, not optional extras;
* Supabase Auth password policy, MFA enforcement and session lifetime are project
  settings, not code. They are listed in `LEGAL_TAX_READINESS.md` §7 as owner
  actions.

---

## 6. Approval

Applying 0106 is part of the migration approval (`MIGRATION_REVIEW_0104_0106.md`
§9); **creating the account is a separate decision** and needs the owner's own
email, phone and a signed-off allowlist row.

| Decision | Tick | Name | Date |
|---|---|---|---|
| Apply 0106 (creates no account) | ☐ | | |
| Create the owner login and confirm the address | ☐ | | |
| Bootstrap that account as the first Super Admin | ☐ | | |
| Enable MFA on the owner login | ☐ | | |

Owner signature: ______________________  Date: ____________
