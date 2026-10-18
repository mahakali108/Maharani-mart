# Service area configuration — Gaya default (migration 0071)

**Review-only deployment guidance.** This branch has not changed a remote database. Gaya, Bihar is the initial *new-row default*, **not** a claim that all Gaya PINs, or any PIN, are currently served. Operators must verify each exact six-digit PIN and its commercial terms before activating it. No real PINs are seeded by migration 0071.

## What changed, and what did not

- `lib/config/service-area.ts` and the `areas.district` column default now say Gaya for **new inventory/pricing area rows**. Migration 0058's historical Saran default remains in migration history; 0071 does not update or rename any existing `areas` row, retailer assignment, address, warehouse, invoice or order.
- `delivery_service_areas` stores independently verified `(district, state, pincode)` rows, activation, minimum order in paise and a delivery fee in paise. Only Admin/Super Admin can read or modify the directory. Deactivate, do not delete, when coverage changes.
- Retailers do **not** get a directory dump; an active approved retailer can ask a guarded RPC whether one exact district/state/PIN is currently enabled. A registration area is **not** evidence of delivery coverage.
- A saved address belonging to the retailer, with street, district, state and six-digit PIN, is required for new web/mobile self-checkout. The preview checks coverage and minimum, and a database insert trigger rechecks under a row lock before committing the order, snapshots the coverage terms and prevents later edits. No coverage is inferred from free-form shop text or an old order.
- A positive delivery fee currently **blocks online ordering** for that PIN. The existing atomic, GST-inclusive, multi-seller order accounting cannot allocate it without introducing a discrepancy; no silent fees or fictional fee collection have been added. The minimum is compared with the final payable order total (after applicable coupon), before the order commits.
- Historical orders and manually captured salesman orders are not backfilled with a verified delivery PIN. Their fulfilment is a separate human-reviewed process; do not treat them as proof of present coverage.

## Before allowing online checkout

1. Confirm the exact target Supabase project, its actual migration history through 0069, and a restorable backup. Read [`UPGRADE_REVIEW.md`](UPGRADE_REVIEW.md) before any deployment; never apply a local migration to an unidentified project. Run the forward migrations **0070, then 0071**, on a disposable/staging clone first. No rollback scripts should be used as an upgrade mechanism.
2. In the admin UI at `/admin/areas`, review existing inventory/pricing areas and retailer assignments. Record which ones (if any) need a **separately authorised** geography correction. Do not automatically relabel Saran or any other district as Gaya.
3. Verify any proposed district/state/PIN with the delivery operation and record who confirmed service, the effective area, minimum and fee outside the app. Add it with **is_active unchecked** first; a saved row by itself is not serviceable. Do not paste a sample PIN from tests into live data.
4. Activate only verified rows with **zero delivery fee** if they should be available for online ordering. A positive fee is a deliberately gated configuration, not a supported online charge. Check current minimums and fulfilment capacity before activating.
5. Ensure the signed-in retailer has an owned saved address with the right structured district/state/PIN. Verify both an approved and unapproved retailer; a covered and uncovered address; a below-minimum order; seller-only and mixed carts; a deactivated PIN and changed minimum; and an idempotent retry. Avoid placing real production orders just to smoke-test.
6. Coordinate client rollout: older mobile API callers that omit `addressId` now fail closed for **new** online quotes/orders. They can still read history and manage saved addresses; they must be updated to submit an address ID before placing new orders. The versioned mobile error vocabulary remains compatible (`conflict` for changed coverage). No native app or APK is produced by this change.

## Read-only preflight (authorised staging/production reviewer)

```sql
select id, name, district, is_active from public.areas order by district, name;
select district, state, pincode, is_active, minimum_order_paise, delivery_fee_paise
  from public.delivery_service_areas order by district, state, pincode;
select count(*) as historical_orders_without_snapshot
  from public.orders where delivery_service_area_id is null;
```

Only run these after confirming migration 0071 is applied to the **intended** project (before then the new table/columns do not exist). Never include business/private address fields in a public verification report. Do not run example INSERT/UPDATE statements in production without owner approval.

## Recovery

If coverage was entered incorrectly, an authorised Admin may deactivate the affected PIN in the UI; this stops new self-checkout, not past order obligations. If a schema defect is found, stop new checkout, preserve existing data and prepare a reviewed **forward** fix or restore a verified backup under an approved recovery plan. Do **not** run migration 0058/0069 rollback scripts on a 0071 schema; their older function bodies can undo security fixes. See [`SERVICE_AREA_SARAN.md`](SERVICE_AREA_SARAN.md) only for the historical 0058 rollout.
