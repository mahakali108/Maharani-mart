# Future Appwrite migration plan (DOCUMENTATION ONLY)

> **Status: not implemented. Not started.**
>
> The application is currently **Supabase-only** — Postgres, Auth, RLS,
> business logic **and** file storage all live in Supabase. Appwrite is not
> installed, no Appwrite SDK dependency is present, no Appwrite environment
> variables exist, and no `appwrite://…` reference is written anywhere.
>
> This document exists so that, *when Supabase Storage approaches its
> configured capacity*, a migration can be planned without touching the
> database schema or business logic.

## When to start

Do **not** migrate proactively. Monitor storage via
`GET /api/admin/storage-report` (admin-only) and the Supabase dashboard.

| Level | Meaning | Threshold (derived) |
| --- | --- | --- |
| `NORMAL` | plenty of headroom | < 70% |
| `WARNING` | start planning | 70–85% |
| `CRITICAL` | prepare the migration | 85–95% |
| `MIGRATION READY` | stop and plan now | > 95% |

When `MIGRATION READY` is reached, **stop** and report:

> "Supabase Storage is approaching the configured migration threshold.
> Appwrite migration can now be planned."

Do **not** automatically migrate or delete anything at any level.

## Design constraint

The migration must be possible **without changing the database or business
logic**. Concretely:

- The database columns stay exactly as they are today
  (`product_images.image_url`, `banners.image_url`, `brands.logo_url`,
  `categories.image_url`, `profiles.avatar_url`, `retailer_documents.file_url`).
- No duplicate media database is introduced.
- The only thing that changes is **where the bytes live** and the value the
  existing column holds (a Supabase public URL/path today; an
  `appwrite://<bucket>/<fileId>` reference after migration).

The single choke point to swap is the media facade (`lib/media/*`), which is
already the only module that uploads/deletes files. Application code and UI
only see a resolved URL or a stored reference.

## Proposed phases (for planning only)

```
Supabase Storage
      │  1. dry-run  (list, map bucket → bucket, report; write nothing)
      ▼
Migration script
      │  2. copy     (read object from Supabase, write to Appwrite)
      │  3. verify   (byte-length / checksum re-read from Appwrite)
      ▼
Appwrite Storage
      │  4. update DB references  (Supabase URL/path → appwrite://<bucket>/<fileId>)
      │  5. verify   (spot-check rendering + private-doc access)
      ▼
Verify
      │
      └─ Only then optionally remove old Supabase files (manual, operator-led)
```

### Phase 1 — Dry run (default)

- Enumerate every object in each Supabase bucket.
- Map each bucket to a target Appwrite bucket (public → public, private →
  private, **never** the reverse).
- Print the plan (counts, per-bucket size) and the rows that would change.
- Write **nothing**.

### Phase 2 — Copy

- Read each object from Supabase Storage, write it into Appwrite with the
  same logical path metadata (`products/{id}/gallery/{uuid}.{ext}`, etc.).
- Files keep their logical folder as audit metadata even though Appwrite
  storage is flat.

### Phase 3 — Verify the copy

- Re-read each copied file's size (and checksum where available) from
  Appwrite and compare against the Supabase source **before** any DB change.
- A failed verification leaves the row untouched — the old Supabase URL keeps
  rendering.

### Phase 4 — Update database references

- Only after a verified copy, rewrite the column value to
  `appwrite://<bucket>/<fileId>` for the migrated row.
- Rows already holding an `appwrite://…` reference are skipped (idempotent).
- Support `--only=<table>` and `--limit=<n>` to migrate incrementally, and a
  `--rollback` that writes the original Supabase value back.

### Phase 5 — Verify

- Spot-check rendering of public media and signed-URL access for private
  retailer documents.

### Phase 6 — (Optional) remove old Supabase files

- **Never automatic.** A deliberate, manual, operator-run cleanup only after
  the migration has been verified in production.

## Safety properties (must hold in any future implementation)

1. **No automatic deletion.** Supabase files are never removed by the
   migration or by any flag. Cleanup is manual and post-verification.
2. **Dry-run by default.** Nothing is written unless an explicit `--apply` is
   passed.
3. **Verify before repointing.** A row is only updated after its copy is
   verified.
4. **Rollback.** Reverting a row means writing the original Supabase value
   back; reverting the whole feature means deploying the previous commit —
   legacy Supabase URLs keep working.
5. **Service-role only.** Any migration script uses the Supabase service-role
   key and must only ever run from a trusted machine / CI secret — never the
   browser.

## Notes / non-goals

- Appwrite would be used for **files only** — no Appwrite Database, Auth or
  Functions.
- The Turso search cache is unrelated to this plan and stays as-is.
- Until this plan is actually executed, the codebase must remain Supabase-only
  (no `node-appwrite` dependency, no Appwrite env vars, no `appwrite://`
  references).
