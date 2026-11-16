# Independent migration review — 0104, 0105, 0106

**Prepared:** 16 November 2026. **Nothing was applied.** Every claim marked
*[executed]* was produced by building a PostgreSQL 16 database from this
repository's own migrations (PGlite) and querying it; every claim marked *[read]*
comes from reading the SQL.

| File | Lines | What it does | Applied? |
|---|---:|---|---|
| `0104_site_content_management.sql` | 745 | content tables, publishing functions, RLS | **no** |
| `0105_seed_site_content.sql` | 847 | 19 draft pages | **no** |
| `0106_first_super_admin_bootstrap.sql` | 233 | guarded first-owner bootstrap | **no** |

Companion documents: `MIGRATION_0104_APPROVAL.md`, `MIGRATION_0105_APPROVAL.md`,
`ROLLBACK_AND_RECOVERY.md`, `SUPER_ADMIN_BOOTSTRAP.md`.

---

## 1. Method

1. Read each file end to end against the objects it claims to depend on.
2. Build the whole migration set in PostgreSQL 16 and **query the catalog**:
   tables, RLS flags, policies, grants, function ACLs, triggers, foreign keys.
3. Execute the release artefacts (stage 1, stage 2, both rollbacks, the continuity
   and publication verification scripts).
4. Re-execute each migration against an already-migrated database (replay).
5. Mutate the fixes to confirm the tests depend on them, not on the fixtures.

Files: `tests/site-content-db.test.ts` (18), `tests/site-content-release.test.ts`
(5), `tests/site-content-continuity.test.ts` (4),
`tests/migration-replay-0104-0106.test.ts` (2),
`tests/super-admin-bootstrap-db.test.ts` (10), `tests/site-content-seed.test.ts` (16).

---

## 2. Object inventory *[executed]*

```
site_pages              RLS on      site_page_sections      RLS on
site_page_admin_notes   RLS on      site_page_revisions     RLS on
super_admin_bootstrap_allowlist RLS on
super_admin_bootstrap_events    RLS on
```

Policies (8 on the content tables, **none** on the two bootstrap tables — deny by
default):

```
site_pages            : super_admin_read (SELECT), super_admin_insert, super_admin_update, super_admin_delete
site_page_sections    : super_admin_read (SELECT), super_admin_write (ALL)
site_page_admin_notes : super_admin_all (ALL)
site_page_revisions   : super_admin_read (SELECT only — history is immutable to API roles)
```

Triggers: `trg_site_pages_before_write`, `trg_site_pages_block_system_delete`,
`trg_site_pages_record_revision`, `trg_site_page_sections_touch`,
`trg_site_page_admin_notes_touch`, and (0106) `trg_guard_profile_role_insert`.

Functions: `published_page(text)`, `published_pages()`, `site_page_snapshot(uuid)`,
`publish_site_page(uuid, boolean)`, `unpublish_site_page(uuid)`,
`is_super_admin()`, `bootstrap_super_admin(uuid)`, `guard_profile_role_insert()`,
plus five trigger bodies. All `SECURITY DEFINER` bodies pin
`set search_path = public, pg_temp`.

---

## 3. Grants matrix *[executed]*

| Object | `anon` | `authenticated` | `service_role` |
|---|---|---|---|
| `site_pages` | none | SELECT/INSERT/UPDATE/DELETE (RLS → `is_super_admin()` only) | ALL |
| `site_page_sections` | none | SELECT/INSERT/UPDATE/DELETE (RLS) | ALL |
| `site_page_admin_notes` | none | SELECT/INSERT/UPDATE/DELETE (RLS) | ALL |
| `site_page_revisions` | none | SELECT (RLS) — no write grant at all | ALL |
| `super_admin_bootstrap_allowlist` | none | none | **SELECT only** |
| `super_admin_bootstrap_events` | none | none | **SELECT only** |
| `published_page()`, `published_pages()` | EXECUTE | EXECUTE | EXECUTE |
| `publish_site_page()`, `unpublish_site_page()`, `is_super_admin()` | none | EXECUTE | EXECUTE |
| `site_page_snapshot()` | none | none | EXECUTE |
| `bootstrap_super_admin()` | none | none | **none** |
| `guard_profile_role_insert()` | none | none | none |

Two things this table is meant to make obvious:

* **`authenticated` holds table privileges**, and RLS is what narrows them to a
  Super Admin. That is the Supabase default model (privilege + policy), not a hole —
  but it means a *future* policy edit is a security change, not a cosmetic one.
* **`anon` holds nothing anywhere** except the two published-content functions.
  A draft, a section of an unpublished page, an internal note and a revision row are
  unreachable from the internet.

---

## 4. Correctness findings

### 4.1 Fixed in this phase — 0104 was not re-runnable

`create policy "site_pages_super_admin_read"` had no matching `drop policy if
exists`. Replaying 0104 on an already-migrated database failed with
`policy … already exists` *[executed]*. The Supabase CLI wraps each migration in a
transaction, but the **SQL editor does not**: an operator whose paste stopped halfway
must be able to re-run the file. Every `create policy` now has a matching drop, and
the replay test passes.

### 4.2 Fixed in this phase — 0106 left the authorisation table writable

`revoke all on table … from public, anon, authenticated` omits `service_role`, and
this project grants API roles ALL on new tables by default. The first version of 0106
therefore let the service key write the allowlist row *[executed — the insert reached
a check constraint instead of being denied]*. `service_role` is now in every revoke,
with `SELECT` re-granted for operational checks. This is the class of bug that a
review of the SQL text does not find and a test does.

### 4.3 Fixed in this phase — PUBLIC EXECUTE on a new trigger function

`guard_profile_role_insert()` inherited `EXECUTE … TO PUBLIC`, which is what 0078
removed for `handle_new_user()`. Trigger functions fire without an EXECUTE check, so
this is reachability over PostgREST rather than an exploit. Revoked.
*[executed: the ACL is now `postgres=X/postgres` only]*

### 4.4 Pre-existing, low severity, not changed

`site_pages_block_system_delete()`, `site_pages_before_write()`,
`site_pages_record_revision()` and the two `*_touch()` functions still carry PUBLIC
EXECUTE. They are trigger functions: calling them directly is either a no-op or
raises, and none takes a parameter an attacker could steer. Left alone deliberately —
changing them would widen this PR's blast radius for no measurable gain. Recorded
here so the next reviewer does not have to rediscover it.

### 4.5 Replay behaviour *[executed]*

| File | Replay on a migrated database | Replay after publication |
|---|---|---|
| 0104 | OK — no row changes (19/70/19 before and after) | OK |
| 0105 | OK — `on conflict do nothing`, guard passes | **refuses**: `0105 must not publish: 9 seeded page(s) are not pure drafts`, and changes nothing |
| 0106 | OK — idempotent | OK |

0105 refusing after publication is correct: re-seeding published policy text is not a
no-op, and the failure is loud rather than silent.

### 4.6 0105 content

19 pages, 70 sections, 165 paragraphs, 42 bullets, 19 internal-notes rows, 15 open
owner decisions, **0 published rows, 0 snapshots, 0 `published_at`** *[executed]*.
`schema_migrations` is the only place a version is written; the seed writes none.

---

## 5. Dependencies

```
auth.users ──(FK)── profiles ──(role)── is_super_admin() ──(policies)── all content tables
                                └──(FK created_by/updated_by/published_by)── site_pages
site_pages ──(cascade FK)── site_page_sections, site_page_admin_notes, site_page_revisions
site_pages ──(read by)── published_page(), published_pages(), site_page_snapshot(),
                          publish_site_page(), unpublish_site_page()
0106 ──(reads)── auth.users, profiles ──(writes)── profiles.role, bootstrap tables
0095/0098 ── legal_document_acceptances, legal_document_current_versions  (0104 writes
             the registry ONLY when publish_site_page(..., true) is called)
```

Reverse dependencies checked *[executed]*: no view or materialised view selects from
these tables; only the three own child tables hold a foreign key to `site_pages`;
`auth.users` gains no new foreign key (the bootstrap allowlist references a user and
is dropped with it via `on delete set null`, the events table via `on delete
restrict`).

One dependency worth stating plainly: **0106's guard trigger is on `profiles`**, a
table every authentication test touches. The full suite (221 files) passes with it,
including retailer signup, staff invitations and seller invitations, because the
trigger only refuses inserts **by API roles** of the two privileged roles.

---

## 6. Rollback

All four files execute *[executed]*; order is 0105 → 0104 for the content module, and
0106 independently.

| File | Guard | Leaves behind |
|---|---|---|
| `0105_…down.sql` | needs `maharani.allow_data_loss = 'true'` (sets it itself), deletes only `is_system` rows whose slug it seeded | pages edited in `/admin/content` |
| `0104_…down.sql` | refuses while `site_pages` holds rows unless the flag is set | nothing |
| `0106_…down.sql` | refuses while the audit trail holds a row unless the flag is set | **the Super Admin it created stays** — rolling back a procedure must not silently remove the only administrator |
| stage 1 / stage 2 | none needed: `unpublish_site_page()` or the SQL in `ROLLBACK_AND_RECOVERY.md` §4.1 | — |

Full runbook, partial-failure table and recovery procedures:
`ROLLBACK_AND_RECOVERY.md`.

---

## 7. Backup and recovery

* `pg_dump` of `public` (or Dashboard → Database → Backups) before S1.
* `ROLLBACK_AND_RECOVERY.md` §5 has a 30-second snapshot table for the two things
  Git does not hold: published snapshots and the registry.
* PGlite is a single connection: it proves statements and dependencies, not
  concurrency. Nothing here has been replayed against a second live connection.

---

## 8. Migration history

`supabase_migrations.schema_migrations` today ends at `20261115155706` (file `0103`,
recorded under its CLI timestamp). Applying through the CLI records `0104`, `0105`,
`0106` — a **mixed** version format that already exists in this project (risk R3 in
`docs/0104_0105_MIGRATION_AUDIT.md`). Whatever channel is used, record the resulting
rows in `docs/MIGRATION_APPLICATION_EVIDENCE.md`:

```sql
select version, name from supabase_migrations.schema_migrations order by version desc limit 5;
```

Applying through the SQL editor records **nothing**. If that channel is chosen, the
row must be inserted deliberately, or the next `db push` will try to re-apply the
file (and, per §4.5, 0105 will refuse once anything is published).

---

## 9. Post-apply verification

Run in this order; each block is read-only and has been executed against a database
built from these migrations.

| After | Query | Expected |
|---|---|---|
| 0104 | `MIGRATION_0104_APPROVAL.md` §5 (A–E) | 4 empty tables, RLS on, `anon` cannot read the table, `anon` can execute the two reads |
| 0105 | `MIGRATION_0105_APPROVAL.md` §4 (1–5) | 19 drafts, 0 published, 0 stamped, 70 sections, index 0, registry still one row |
| 0106 | `SUPER_ADMIN_BOOTSTRAP.md` §4 step 5 | one allowlist row, consumed only after the bootstrap |
| stage 1 | `verify_publication.sql` + `verify_continuity.sql` | 9 published, 10 drafts, `published_without_snapshot = 0`, continuity `missing = 10` (the known gap) |
| stage 2 | `verify_continuity.sql` | `published = 19, missing = 0`, index 19 |

---

## 10. Verdict and approval

**No correctness defect remains in 0104/0105/0106 that this review can find.** The
three fixed in this phase were all invisible to a text review and all found by
execution. Residual risks are operational, not SQL: the apply channel and its effect
on migration history (§8), the single-connection limit of the test database (§7), and
the fact that nothing here has been run against the official project.

| Decision | Tick | Name | Date |
|---|---|---|---|
| Apply 0104 | ☐ | | |
| Apply 0105 | ☐ | | |
| Apply 0106 | ☐ | | |
| Accept the residual risks in §10 | ☐ | | |

Owner signature: ______________________  Date: ____________
