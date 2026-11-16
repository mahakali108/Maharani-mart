# Acceptance registry — options A, B and C

**Subject:** `legal_document_current_versions` and the documents customers are asked
to accept.
**Prepared:** 16 November 2026. **Status: NO REGISTRY CHANGE. The registry is exactly
as it was — one row, `seller-agreement 1.0`.**

---

## 1. What exists today (verified read-only, 16 November 2026)

```
legal_document_current_versions
  seller-agreement | 1.0 | published before this change      ← 1 row

legal_document_acceptances
  (no rows)                                                   ← 0 rows
```

Nothing else is registered. `record_legal_acceptance()`, `publish_legal_document_version()`
and the two tables come from migrations 0095 and 0098; neither is modified by 0104/0105.

### How a version is enforced

| Registry row for the key | What `record_legal_acceptance()` does |
|---|---|
| exists, version = X | records only version X; any other version raises `LEGAL_VERSION_NOT_CURRENT` |
| missing | records whatever version the server sent — **no enforcement at all** |

### Which keys the application asks for

`lib/legal/documents.ts` → `REQUIRED_ACCEPTANCE`:

```
retailer gate : terms, privacy, retailer-terms
seller gate   : terms, privacy, seller-agreement, prohibited-products
union         : 5 keys   (terms, privacy, retailer-terms, seller-agreement, prohibited-products)
```

`getAcceptanceStatus()` always lists those keys (it reads the code registry and only
*overrides the version* from the database), so the screen asks for all five today —
but only `seller-agreement` is actually pinned.

---

## 2. The three options

### A — leave the registry as it is (seller agreement only)

| | |
|---|---|
| Registered | 1 of 5 keys |
| Enforced | seller agreement only |
| Recorded acceptances | any version the server sends, for the other four |
| Technical impact | none; no migration, no SQL |
| Risk | the four unregistered keys can be re-worded in `/admin/content` without a version bump and no error is raised; an acceptance of `terms 1.0` is evidence of *when* someone clicked, not proof of *which text* they saw enforced by the database |

This is the status quo. It is safe, and it is the only option that needs no action.

### B — register the documents that are genuinely consented to (recommended)

| | |
|---|---|
| Registered | 5 keys: `terms`, `privacy`, `retailer-terms`, `seller-agreement` (already), `prohibited-products` |
| Enforced | all five |
| Technical impact | five `insert … on conflict` rows; from that moment a version mismatch raises `LEGAL_VERSION_NOT_CURRENT` and the acceptance screen refreshes instead of recording |

**B must be split in two, because of a dependency this review found:**

* **B1 — after stage 1: `terms`, `privacy`.** Both pages are public after stage 1, so
  the acceptance card's links resolve.
* **B2 — only after the page is public: `retailer-terms`, `prohibited-products`.** They
  are stage-2 drafts. Registering them before publication creates a gate that asks a
  person to accept a document whose page answers "This page is not available right
  now." — the link in the acceptance card points at `/legal/retailer-terms`.
  (`seller-agreement` is already registered and is also a stage-2 draft: **today a
  seller-account invitation would ask for acceptance of a page that is not
  available** as soon as this deploy lands. That is an argument for publishing the
  ten in the same window — `STAGE1_PAGE_REVIEW.md` §1.1, option B.)

### C — register all 19 pages

| | |
|---|---|
| Registered | 19 keys (17 legal + `about`, `contact`) |
| Enforced | all 19 |
| Technical impact | every copy edit to any page becomes a consent event; a typo fix in About would need a version bump or would start raising `LEGAL_VERSION_NOT_CURRENT` for anyone mid-acceptance |
| Why not | 14 of the 19 are **notice** documents (returns, shipping, grievance, cookies, IP complaints, …). Nobody "accepts" them; registering them claims an audit trail that does not correspond to any consent, and it pins versions for pages the acceptance UI never shows. It is a net loss: more failure modes, no legal gain |

C is listed because it was one of the three options under consideration. It should
not be chosen.

---

## 3. Which documents genuinely need a recorded acceptance

| Key | Nature | Record acceptance? | Why |
|---|---|---|---|
| `terms` | contract of use | **yes** | placing an order is contractual; the version matters |
| `retailer-terms` | contract for business buyers | **yes** | additional duties (resale, pricing category) |
| `seller-agreement` | contract with sellers | **yes (already)** | the only key enforced today |
| `prohibited-products` | seller warranty + takedown | **yes, with the seller agreement** | it is the seller's undertaking, not a notice |
| `privacy` | notice + acknowledgement | **yes, as acknowledgement** | evidence that the notice was shown; it is *not* a lawful basis for processing, so do not describe it as "consent" in the UI copy |
| `returns`, `shipping`, `damaged-goods`, `grievance`, `business-disclosure`, `gst-pricing-invoice`, `marketplace-disclaimer`, `ip-complaints`, `suspension-termination`, `cookies`, `coins-loyalty` | notices / procedures | **no** | published, not accepted |
| `about`, `contact` | information pages | **no** | not documents in any legal sense |

---

## 4. Exact SQL for option B (NOT EXECUTED — awaiting approval)

B1, after stage 1 is verified:

```sql
-- register the two consent documents that are public after stage 1
insert into public.legal_document_current_versions (document_key, document_version)
values ('terms', '1.0'), ('privacy', '1.0')
on conflict (document_key) do update
  set document_version = excluded.document_version,
      published_at = now()
 where public.legal_document_current_versions.document_version
       is distinct from excluded.document_version;

select document_key, document_version, published_at
  from public.legal_document_current_versions order by 1;
-- expected: privacy 1.0, seller-agreement 1.0, terms 1.0
```

B2, only after `retailer-terms` and `prohibited-products` are published:

```sql
insert into public.legal_document_current_versions (document_key, document_version)
values ('retailer-terms', '1.0'), ('prohibited-products', '1.0')
on conflict (document_key) do update
  set document_version = excluded.document_version,
      published_at = now()
 where public.legal_document_current_versions.document_version
       is distinct from excluded.document_version;
```

Why SQL and not the admin UI: `publish_site_page(page, true)` would do this
correctly, but it (and `publish_legal_document_version()`) requires
`auth.uid()` to be a profile with `role = 'super_admin'`, and the live project has
**zero `auth.users` and zero `profiles`**. Until the first Super Admin exists, the
registry can only be changed by SQL as the project owner / `service_role`. The
`on conflict … where` form is the same statement
`publish_legal_document_version()` performs, so the two cannot diverge.

Rollback of a mistaken row: `ROLLBACK_AND_RECOVERY.md` §4.5. Never delete the
`seller-agreement` row.

---

## 5. Consequence of doing nothing (option A) after this release

* Sellers: unchanged — the agreement is enforced at `1.0`.
* Retailers: the screen lists three documents, none enforced. If the owner edits
  `terms` and republishes with the same version string, an existing acceptance still
  matches and no one is re-prompted. **That is the real cost of A**: a material
  change to the terms can go live without anyone re-accepting.
* The four unregistered keys stay editable without a version bump — which is also a
  convenience if the owner wants to fix the caveats in `STAGE1_PAGE_REVIEW.md` §4 F2
  before registering anything (recommended: fix the text first, then register).

---

## 6. Recommendation

1. Fix or accept the copy issues (F1/F2/F4) **before** registering anything.
2. Run **B1** the same day as stage 1, once the pages are public.
3. Run **B2** only when the stage-2 pages are public, in the same window.
4. Do not choose C.
5. Whatever is chosen, record it: date, who, the SQL run, and the output of the
   verification query.

| Decision | Tick | Name | Date |
|---|---|---|---|
| A — no change | ☐ | | |
| B1 — register `terms`, `privacy` after stage 1 | ☐ | | |
| B2 — register `retailer-terms`, `prohibited-products` after publication | ☐ | | |
| C — register all 19 (not recommended) | ☐ | | |

Owner signature: ______________________  Date: ____________
