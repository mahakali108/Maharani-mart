# System architecture: current and proposed

Date 2026-11-01. Verified = repository source observed, not deployed state. Proposed = subject to owner approval. See baseline for limits.

## Current source architecture

```text
Retailer browser / PWA ---- Next.js App Router ----- Supabase Auth + Postgres/RLS + Storage
Seller browser ------------ server actions/RPCs ---- same backend, seller-scoped permissions
Admin/staff/salesman ------- middleware + guards ---- server-side checks + audited RPCs
Retailer native Android --- /api/mobile/v1 --------- same authorized business services
                                      optional Turso search cache; Vercel analytics/hosting
```

- `/` redirects to login/role home; `/retailer/home` is existing discovery surface. Seller invitations are Super Admin-only by stated UI; verify action, auth creation, RLS, privilege escalation and suspension independently.
- `middleware.ts`, `lib/auth`, server actions and SQL policies share responsibility. UI visibility and middleware are not sufficient: establish least-privilege checks at each protected action/RPC and RLS. `SECURITY DEFINER` routines must check caller, pin search_path, revoke unneeded execute grants and be tested for role inheritance.
- Seller offer/settlement and own-stock pricing are different domain paths; do not flatten into one unchecked price. Server-authoritative quote, taxes, MOQ, stock, seller identity and atomic idempotent checkout; persisted invoice snapshots and reconciliation. Verify concurrency in real isolated Postgres.
- Preserve existing routes, PWA, seller/staff/salesman/admin workflows; change marketing surfaces separately from violet app tokens. Existing legal routes and draft policies require owner/legal approval before claims.
- Avoid food by a trusted approved product-classification system and verified business review, not merely keyword search. Pending migration 0086 is not proven deployed. Enforce at create/publish/offer/order paths and audit legacy data on an approved read-only basis.

## Recommended target

One web app, one retailer-only native Android app using current versioned mobile API, one verified Supabase project; no Android seller/admin apps, no Flutter, no new backend or secret in client. Mobile should cache only appropriately classified catalogue information with TTL and invalidation; prices, availability and authorization revalidate online. Idempotency prevents double checkout; never transact offline.

Domain ownership to document and test: identity/permissions, catalog/product compliance, inventory, quotes/orders/invoices/returns, seller settlement and reconciliation, promotions, notifications, legal versions and immutable audit. Separate seller document storage with private short-lived signed URLs; don't reuse public image buckets. Admin-only capabilities must validate true `super_admin` in server/RPC (not broadly `admin_or_above` when the requirement says super-admin only). Validate every route against the permission matrix.

## Unresolved decisions

Supplier-of-record per line, mixed cart invoicing and cash flow/TCS, fee handling, marketplace settlement, seller auto-publish trust policy, paid membership reversal, discount stack/caps, loyalty redemption/expiry and ads disclosures require owner/CA/legal decisions. Existing category-based own-stock discounts and seller-specific pricing must not be rewritten blindly. No promise of a certified tax invoice or payment integration based solely on a screen.

## Integration contract and observability

`/api/mobile/v1` should keep typed versioned schemas and compatible error codes, stable idempotency keys, pagination, server-generated totals, rate limits, and privacy-safe request IDs. Security logs record actor, object, operation and outcome without secrets/PII; failures fail closed. Add safe incident response, backups and restore evidence, deployment environment identity and migration parity before release. Existing docs: `docs/NATIVE_ANDROID_API_CONTRACT.md`, `docs/role_permission_matrix.md`, `docs/ORDER_FLOW_AUDIT.md` and `docs/SELLER_MARKETPLACE.md` are starting points, not current production proof.
