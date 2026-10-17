# Super Admin + Supplier Management — Phase 1 Inventory & Gap List

Generated 2026-10-17 from the actual checkout (`arena/851511a1-maharani-mart`,
HEAD `092c4d1`, clean tree at inspection). No production data, credentials,
PR #107, or audit reports were touched. Note: the referenced local commit
`1b4992ca…` and four untracked audit reports were **not present** in this
checkout (single commit on the branch, clean status) — nothing to preserve
or stage here; flagged for the owner to verify on the machine that holds them.

## What already exists (verified)

| Area | Evidence |
|---|---|
| Roles | `super_admin, admin, staff, salesman, retailer` (`lib/auth/roles.ts`). **No supplier role.** |
| Permission engine | `lib/permissions/permissions.ts`, server guard `lib/admin/guard.ts` (`requirePermission` / `requirePagePermission`), middleware prefix map. |
| Super Admin | Command Center (`command_center.view`, super_admin only) with a Suppliers tab; Control Center; audit logs; AI copilot (read-only super-admin tools). |
| Purchasing today | GRN workflow (0017): `grns`, `grn_items`, `inventory_batches`, FEFO, stock ledger. RLS: `is_staff_or_above()` read/write on grns/grn_items. Supplier = **free text** `supplier_reference` + `invoice_reference`; 0017/0050 explicitly state no supplier master exists. |
| Catalogue at scale | `/admin/products`: server-side search/filters/sort, bounded batches (25), CSV import/export with shared validation (`lib/admin/product-csv.ts`), safe bulk actions (`MAX_BULK_IDS`, per-row audit triggers). Derived sort/filter working set capped at `ADMIN_DERIVED_LOOKUP_LIMIT = 1000` (UI discloses it). |
| Retailer ordering / returns / payments | Orders, deliveries, collections (0044), wallets, returns — retailer-facing; these are **customer** receivables, not supplier payables. |
| Warehouses | `warehouses` table + transfers exist, but product stock is pack-based (0054 simplified pack stock) — do not reinterpret as supplier-owned or multi-warehouse supplier stock. |

## What does NOT exist (do not invent)

- Supplier master (`suppliers` table), supplier login/portal, supplier
  onboarding/verification documents, GSTIN/legal identity storage.
- Purchase orders distinct from draft GRNs; expected-delivery dates;
  supplier invoices as payable documents; supplier payments, credit terms,
  settlements, commissions, marketplace sales, supplier-owned inventory,
  supplier disputes/returns-to-supplier.
- Any RLS tenant/supplier isolation for supplier users (no such users exist).

## Implemented in this phase (Phase 2, no migration)

**Supplier Directory & Purchase Ledger — `/admin/suppliers`**
(`suppliers.view`: super_admin + admin, because unit costs are exposed).

- Server-side: page guard → caller's RLS-scoped client only (no service role).
- Bounded queries: 25-row ledger page + exact count, status/head counts,
  supplier summary over the latest 300 non-cancelled GRNs (labelled in UI,
  truncation disclosed).
- Search (GRN no. / supplier ref / supplier invoice ref, metacharacters
  stripped), status filter, exact supplier filter, Previous/Next pagination
  (page clamped to 200).
- Loading skeleton, honest empty state, error card with recovery link,
  accessible tables/labels/nav. Stock shown is Maharani-owned (GRN-received);
  supplier-owned inventory is explicitly not represented.
- Files: `lib/admin/suppliers-query.ts`, `lib/admin/suppliers-data.ts`,
  `app/admin/suppliers/page.tsx`, `app/admin/suppliers/loading.tsx`,
  permission + nav wiring, `tests/suppliers-directory.test.ts`.

## Prioritized gaps & required decisions (next phases)

1. **Supplier master (Phase 3)** — needs an approved migration, e.g.
   `suppliers(id, legal_name, display_name, contact…, gstin NULL, status
   pending/verified/suspended, verified_by/at, created_by)`, private document
   bucket with admin-only RLS, and optional `grns.supplier_id` FK kept
   nullable beside the legacy free-text reference for backfill. **Do not
   apply without owner approval**; do not fabricate GSTINs for existing
   free-text references — backfill only by human confirmation.
2. **Purchase orders / payables (Phase 5)** — business rules needed first:
   PO approval thresholds, partial receiving, price-variance tolerance,
   payment terms, and who may record supplier payments. Only then design
   `purchase_orders`, `supplier_invoices`, `supplier_payments` with RLS.
3. **Supplier returns/disputes** — depend on (2); returns-to-supplier must
   reverse batches/ledger through existing GRN/batch machinery, not ad-hoc
   stock edits.
4. **Catalogue >2,000 products** — the 1,000-row derived-sort cap will bind
   before 2,000; move stock/sales/margin sorts into SQL views/RPC with
   keyset pagination before raising caps.
5. **Supplier portal** — only after (1) + a `supplier` role, per-supplier
   RLS (`supplier_id = auth profile's supplier`), and a decision that
   third-party marketplace sales/commissions are actually in scope
   (currently explicitly out of scope).

## Permission/RLS evidence for this phase

- App layer: `can('staff'|'salesman'|'retailer','suppliers.view') === false`
  (unit-tested); page uses `requirePagePermission` (redirect, not throw).
- DB layer unchanged: `grns_staff_read` etc. (`is_staff_or_above()`, 0017)
  remain the boundary; staff can still reach GRNs via existing inventory
  routes exactly as before — this phase adds no new write path at all.
- No migration applied; no service-role usage added (statically tested).
