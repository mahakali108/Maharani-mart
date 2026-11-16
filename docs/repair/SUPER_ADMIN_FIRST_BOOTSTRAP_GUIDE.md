# Super Admin — first account bootstrap guide

**Audience:** the owner of Maharani Traders (AJAY KUMAR / AJAY GENERAL).
**Project:** `Maharani-mart` — Supabase ref `fhrmsrumsraprvutrpeo`.
**Never use** the legacy project `maharanimaa` (`gbxhmffsbsfhdrfuwurx`).

> **This guide describes a procedure. Nothing in it has been executed.**
> No production Super Admin exists, no allowlist row exists, and migrations
> `0104`–`0108` have not been applied to the live project. Every step below is
> an owner action, performed by you, in the Supabase SQL editor.

---

## 1. Why this is not just "flip a column to super_admin"

The application deliberately has **no** path from a web form or an API call to
a Super Admin account. That is not an oversight; three separate controls stop it:

| Control | File | What it refuses |
| --- | --- | --- |
| `handle_new_user()` reads the role from a server-side invite table only | `supabase/migrations/0072_super_admin_seller_invitations.sql` | A signup that claims `role: super_admin` in its metadata gets `retailer`. |
| `guard_profile_privileged_columns()` | `0052_phase0_security_hardening.sql` | Any API caller changing a `role` or `is_active` unless it is **already** a Super Admin. |
| `guard_profile_role_insert()` | `0106_first_super_admin_bootstrap.sql` | An API caller inserting a profile whose role is `admin` or `super_admin`. |

So the first Super Admin cannot be created through the product at all — which is
correct, and is also why the project currently has an admin dashboard nobody can
legitimately open.

`0106` adds the one remaining path and makes it explicit, one-time and
auditable. It is **not applied yet**; step 2 below applies it.

---

## 2. What `0106` actually adds

| Object | Purpose | Who may touch it |
| --- | --- | --- |
| `public.super_admin_bootstrap_allowlist` | Exactly **one** row (`id = 1`) naming the person allowed to become the first Super Admin. | Writable by the database owner only. `anon`, `authenticated` and `service_role` all have **no** privilege on it; `service_role` may `select` for operational checks. |
| `public.super_admin_bootstrap_events` | Append-only evidence: profile id, e-mail, previous role, `session_user`, timestamp. | Written only by `bootstrap_super_admin()`. No API role has `insert`/`update`/`delete`. |
| `public.bootstrap_super_admin(p_profile_id uuid)` | Promotes the allowlisted, e-mail-confirmed account **once**. | `EXECUTE` revoked from `public`, `anon`, `authenticated`, `service_role`. Only the database owner. |
| `trg_guard_profile_role_insert` | Closes the INSERT side of profile creation. | Trigger; not callable. |

### The ten behaviours that make it safe

1. **Owner-controlled only.** The function refuses unless
   `session_user in ('postgres','supabase_admin')`. PostgREST connects as
   `authenticator` and then assumes `anon`/`authenticated`, so an API request can
   never satisfy this — even if a future migration granted `EXECUTE` by mistake.
2. **No API role can call it.** `revoke all ... from public, anon,
   authenticated, service_role`. Proven by
   `tests/super-admin-bootstrap-db.test.ts` → *"is not executable by any API
   role"*.
3. **`service_role` cannot bypass it.** It has no write privilege on the
   allowlist and no `EXECUTE`. Proven by *"keeps the allowlist and the audit
   trail away from API roles"*.
4. **Confirmed e-mail only.** `auth.users.email_confirmed_at` must be non-null.
   An unverified address is not an owner identity.
5. **One-time by construction.** One allowlist row; the function refuses if
   **any** `super_admin` already exists; it stamps `consumed_at`; a second call
   raises `23505`.
6. **The address must match.** The confirmed `auth.users.email` must equal the
   allowlisted address (case/space-normalised), or the call raises `23514`.
7. **Append-only evidence.** The event row is written in the same transaction as
   the promotion. A failure anywhere rolls back all of it.
8. **No privilege escalation through RPC.** The function is not reachable over
   PostgREST; the two guard triggers cover the table paths it would have to use.
9. **No default or hardcoded account.** There is no seeded owner e-mail, no
   environment variable and no magic address anywhere in the repository. The
   allowlist starts **empty**, which makes the function fail closed
   (`P0002 — No bootstrap allowlist row`).
10. **Auditable and recoverable.** The event row survives; the rollback
    (`supabase/rollbacks/0106_first_super_admin_bootstrap.down.sql`) refuses to
    drop the evidence table while it holds a row unless the operator explicitly
    opts into data loss, and **never** demotes the account it created.

---

## 3. Pre-flight (read-only, owner)

Run these in the Supabase **SQL editor** for `fhrmsrumsraprvutrpeo`. They change
nothing.

```sql
-- 3.1 Which migrations are recorded? Adjust the tail after applying 0104-0108.
select version, name from supabase_migrations.schema_migrations
 order by version desc limit 5;

-- 3.2 Is a Super Admin already present? The bootstrap only runs while this is 0.
select count(*) as super_admins from public.profiles where role = 'super_admin';

-- 3.3 Does a bootstrap allowlist exist yet? Expect: relation does not exist
--     before 0106 is applied.
select to_regclass('public.super_admin_bootstrap_allowlist') as allowlist;
```

Expected before you start:

| Check | Expected value |
| --- | --- |
| `super_admins` | `0` — if it is ≥ 1, **stop**; use the team screen instead |
| `allowlist` | `NULL` (0106 not applied yet) |

---

## 4. Step 1 — apply the pending migrations (owner, one approval)

Apply in this order, inside a transaction, and **only after** the owner has
approved each file:

```
0104_site_content_management.sql
0105_seed_site_content.sql        -- seeds 19 pages / 70 sections, ALL as drafts
0106_first_super_admin_bootstrap.sql
0107_restore_cost_price_column_lockdown.sql
0108_publishing_integrity.sql
```

`0104` is ~750 lines of DDL. The Dashboard SQL editor does **not** wrap a file in
a transaction, so either use the CLI (`supabase db push --include-all`) or paste
the file wrapped in `begin; … commit;`. A failure halfway through the editor
leaves a partial schema; the CLI does not.

Afterwards, verify:

```sql
select count(*) as pages    from public.site_pages;               -- 19
select count(*) as sections from public.site_page_sections;       -- 70
select count(*) as published from public.site_pages where status = 'published';  -- 0
select count(*) as allowlisted from public.super_admin_bootstrap_allowlist;      -- 0
```

**The seed publishes nothing.** Every page is a draft until you publish it in
`/admin/content` or run one of the reviewed scripts in `supabase/publication/`.

---

## 5. Step 2 — create the owner login

The bootstrap promotes an **existing** account; it does not create one.

1. Open `https://maharanitraders.vercel.app/register` (or the sign-in page).
2. Register with the owner e-mail address **you intend to authorise**. Use a real
   inbox you control — step 3 requires a confirmed address.
3. Click the confirmation link in that inbox.

Then read back the id and confirm the address (read-only):

```sql
select id, email, email_confirmed_at
  from auth.users
 where lower(btrim(email)) = lower(btrim('OWNER_EMAIL_HERE'));
```

Requirements before continuing:

* exactly **one** row is returned;
* `email_confirmed_at` is **not** null;
* the address is spelled exactly as you will write it in step 3.

> If registration was disabled, create the user from **Authentication → Users →
> Add user** with *Auto Confirm User* ticked, then confirm the same query returns
> one confirmed row.

---

## 6. Step 3 — write the single allowlist row (owner)

Replace the four placeholder values. The database validates the e-mail shape, a
10-digit phone, and a 2–120 character name; a wrong value is rejected here rather
than at bootstrap time.

```sql
insert into public.super_admin_bootstrap_allowlist (id, email, full_name, phone, note)
values (
  1,
  lower(btrim('OWNER_EMAIL_HERE')),      -- must equal the auth.users address
  'AJAY KUMAR',                          -- owner's name, 2-120 chars
  '8987023959',                          -- 10 digits, no +91
  'Owner authorisation recorded <date>; see docs/repair/SUPER_ADMIN_FIRST_BOOTSTRAP_GUIDE.md'
);
```

Verify it is exactly one unconsumed row:

```sql
select id, email, full_name, consumed_at from public.super_admin_bootstrap_allowlist;
-- expect: 1 row, consumed_at IS NULL
```

---

## 7. Step 4 — run the bootstrap (owner, once)

Take the `id` from step 2 and run, **still in the SQL editor**:

```sql
select public.bootstrap_super_admin('PASTE-AUTH-USER-UUID-HERE');
```

What the function does, in order:

1. refuses unless `session_user` is `postgres`/`supabase_admin`;
2. refuses if **any** `super_admin` already exists;
3. locks and reads the allowlist row, refusing if it is missing or consumed;
4. loads `auth.users`, refusing a missing account, an unconfirmed address, or a
   mismatched e-mail;
5. promotes the profile to `super_admin`, forces `is_active = true`, and fills a
   blank display name from the allowlist (it never overwrites a real one);
6. stamps `consumed_at` / `consumed_profile_id` on the allowlist row;
7. appends one row to `super_admin_bootstrap_events`.

All seven steps are one transaction. There is no partial state.

---

## 8. Step 5 — verify (read-only)

```sql
-- 8.1 Exactly one Super Admin.
select p.id, p.full_name, p.role, p.is_active, u.email
  from public.profiles p join auth.users u on u.id = p.id
 where p.role = 'super_admin';

-- 8.2 The authorisation was consumed exactly once.
select id, email, consumed_at, consumed_profile_id
  from public.super_admin_bootstrap_allowlist;

-- 8.3 The evidence row exists.
select profile_id, email, previous_role, session_role, occurred_at
  from public.super_admin_bootstrap_events
 order by occurred_at desc;

-- 8.4 The escalation is now closed: a second call must fail.
select public.bootstrap_super_admin('<same-uuid>');
-- expected error: "A Super Admin already exists (1). Use the team screen, not the bootstrap."
```

Then, in the browser:

1. Sign in at `https://maharanitraders.vercel.app/login` with the owner account.
2. You land on `/admin/dashboard`.
3. `/admin/content` opens. Before publication every page shows **Draft**.
4. `/admin/control-center` opens. A non-Super-Admin gets `/unauthorized` — check
   this by signing in as an ordinary retailer in a private window.

---

## 9. What the owner should do next, and what stays off-limits

| Action | Safe now? | Notes |
| --- | --- | --- |
| Register/login as the Super Admin | yes | step 5 |
| Edit page drafts in `/admin/content` | yes | drafts are invisible to customers |
| Preview a draft | yes | renders through the public component with an admin banner |
| Publish the 9 pages whose wording is already live | **owner decision** | `supabase/publication/stage1_publish_live_text.sql` |
| Publish the 10 new pages | **after owner + legal review** | `stage2_publish_reviewed_additions.sql` |
| Register a Terms/Privacy acceptance version | **legal decision** | ticks the box on publish; pins that version forever |
| Create a second Super Admin | later, deliberately | from `/admin/control-center` once one exists — the bootstrap is one-time and will refuse |
| Invite a seller | only after legal/tax approval | marketplace selling stays disabled until then |

### Never do

* Do **not** edit `supabase_migrations.schema_migrations` to "fix" the
  timestamped `0103` row (`20261115155706`). It is recorded evidence of how that
  migration was applied. `supabase db push` warns about it; the warning is
  expected and is not a failure.
* Do **not** insert a `super_admin` row into `profiles` with `UPDATE`. That is the
  un-auditable path this whole process exists to replace, and it leaves no
  evidence of who did it.
* Do **not** run the bootstrap twice. If the account is wrong, demote it
  deliberately (`update public.profiles set role = 'retailer' where id = …`) and
  write a fresh allowlist row — but the second bootstrap only works when **no**
  Super Admin exists, so plan the transition first.

---

## 10. Recovery

| Situation | What to do |
| --- | --- |
| Bootstrap raised *"No bootstrap allowlist row"* | Step 3 was skipped. Insert the row and retry. |
| Bootstrap raised *"Confirm the e-mail address before bootstrapping"* | Confirm the address in the owner inbox, then retry. |
| Bootstrap raised *"The allowlisted address does not match this account"* | The allowlist row and the account disagree. Fix the allowlist row (`update … set email = … where id = 1`) **before** it is consumed, then retry. |
| Bootstrap raised *"A Super Admin already exists"* | Someone already bootstrapped. Use `/admin/control-center` → Users to manage roles. |
| The wrong person was promoted | Demote deliberately (`update public.profiles set role = 'retailer' where id = …`), record why, then bootstrap again with a corrected allowlist row. |
| Everything must be undone | `supabase/rollbacks/0106_first_super_admin_bootstrap.down.sql` removes the function and both tables **without demoting anybody**. It refuses while the evidence table holds a row unless `set maharani.allow_data_loss = 'true'`. |

---

## 11. Evidence to keep

Save the outputs of step 8.1–8.3, the date, and the approver's name with the
project records. The three rows (allowlist, event, profile) are the only audit
trail of how the first privileged account came to exist; nothing in the
application can recreate or amend it.

---

**Summary of owner actions required**

1. Confirm the owner e-mail address to be used.
2. Approve and apply `0104`, `0105`, `0106`, `0107`, `0108` (one approval).
3. Register/confirm the owner login (step 2).
4. Insert the single allowlist row (step 3).
5. Run `bootstrap_super_admin()` once (step 4).
6. Verify and archive the evidence (steps 5 and 11).
7. Decide separately which pages are published and when.
