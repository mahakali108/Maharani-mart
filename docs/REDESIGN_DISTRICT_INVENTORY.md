# District and service-area inventory — 14 October 2026

Repository-wide text search over tracked source and intended new files, excluding this generated audit family and binary assets. Direct search: `district|saran|khagaria|chhapra|chapra` (case insensitive). Dependency search additionally includes `area_id|areaId|SERVICE_AREA_LABEL|service-area`. Line numbers refer to the reviewed working tree before this report was added.

## Representation and decisions

- Service geography lives in `areas.district`; `retailers.area_id` determines the retailer's verified service assignment. Registration submits the area FK, not an independent district string.
- `retailer_addresses.district` is an independent optional delivery-address field. Changing it must not reassign the retailer or rewrite historical checkout snapshots.
- Saran is the existing **new-area default**, not the only valid district. The real configured directory supplies registration/admin options. Free-text address districts and admin-created districts remain supported, including legitimate other districts.
- Do not equate Chapra/Chhapra (city names) with a district automatically. No alias rewrite or production assignment migration is justified by the repository alone.
- Old Khagaria defaults in migration 0001 and rollback 0058, historical tests and docs are retained intentionally. Migration 0058 already changes only the default. No new migration or seed was needed or executed.
- API/mobile address CRUD shares `addressPayloadSchema`; registration uses the existing UUID and active-area database trigger. Admin changes use permission checks and the normal RLS-scoped Supabase client, never a client-only guard or service-role shortcut.
- Native Android display/DTOs and API response shapes are unchanged. No district-specific reports were added; existing reports continue using their area/order records.

## Direct references (one row per file; all matching lines listed)

| Location | Lines | Disposition |
|---|---|---|
| `ARCHITECTURE.md` | 3, 13, 284, 311 | Historical documentation/business context retained; does not assign retailers. |
| `README.md` | 3, 93 | Updated presentation, district labels/selection/filtering, or shared validation; see review summary. No existing record rewritten. |
| `android/core/network/src/main/kotlin/com/maharanitraders/core/network/dto/AuthDtos.kt` | 122 | Native DTO/UI/validation or legacy fixture preserved; no native redesign; compatible web API payload retained. |
| `android/core/network/src/main/kotlin/com/maharanitraders/core/network/dto/CommerceDtos.kt` | 91, 121 | Native DTO/UI/validation or legacy fixture preserved; no native redesign; compatible web API payload retained. |
| `android/feature/auth/src/main/kotlin/com/maharanitraders/feature/auth/AreaDirectory.kt` | 38 | Native DTO/UI/validation or legacy fixture preserved; no native redesign; compatible web API payload retained. |
| `android/feature/auth/src/main/kotlin/com/maharanitraders/feature/auth/RegisterScreen.kt` | 269 | Native DTO/UI/validation or legacy fixture preserved; no native redesign; compatible web API payload retained. |
| `android/feature/auth/src/main/kotlin/com/maharanitraders/feature/auth/RegisterViewModel.kt` | 21 | Native DTO/UI/validation or legacy fixture preserved; no native redesign; compatible web API payload retained. |
| `android/feature/auth/src/test/kotlin/com/maharanitraders/feature/auth/RegisterViewModelTest.kt` | 36, 49 | Native DTO/UI/validation or legacy fixture preserved; no native redesign; compatible web API payload retained. |
| `android/feature/orders/src/main/kotlin/com/maharanitraders/feature/orders/CommerceModels.kt` | 56, 72, 339, 381, 382, 410 | Native DTO/UI/validation or legacy fixture preserved; no native redesign; compatible web API payload retained. |
| `android/feature/orders/src/main/kotlin/com/maharanitraders/feature/orders/CommerceRepository.kt` | 249, 287 | Native DTO/UI/validation or legacy fixture preserved; no native redesign; compatible web API payload retained. |
| `android/feature/orders/src/main/kotlin/com/maharanitraders/feature/orders/ui/AddressBookScreen.kt` | 325, 326, 327, 328 | Native DTO/UI/validation or legacy fixture preserved; no native redesign; compatible web API payload retained. |
| `app/admin/areas/[id]/page.tsx` | 1, 15, 43, 48, 49, 79, 84, 86 | Updated presentation, district labels/selection/filtering, or shared validation; see review summary. No existing record rewritten. |
| `app/admin/areas/page.tsx` | 2, 16, 21, 23, 26, 27, 28, 35, 43, 47, 48, 49, 50, 51, 60, 61, 69, 77 | Updated presentation, district labels/selection/filtering, or shared validation; see review summary. No existing record rewritten. |
| `app/admin/retailers/[id]/page.tsx` | 1, 28, 55, 78, 177, 179 | Updated presentation, district labels/selection/filtering, or shared validation; see review summary. No existing record rewritten. |
| `app/admin/retailers/page.tsx` | 1, 35, 155, 162, 219, 233, 236, 237, 238, 239, 240, 287, 288, 289, 290, 291, 303, 305, 317, 321, 334 | Updated presentation, district labels/selection/filtering, or shared validation; see review summary. No existing record rewritten. |
| `app/api/mobile/v1/areas/route.ts` | 36, 49, 61 | Already returns stored district with active areas; unchanged contract, no invented coverage. |
| `app/register-retailer/page.tsx` | 16, 25 | Updated presentation, district labels/selection/filtering, or shared validation; see review summary. No existing record rewritten. |
| `app/retailer/account/addresses/page.tsx` | 17 | Updated presentation, district labels/selection/filtering, or shared validation; see review summary. No existing record rewritten. |
| `app/retailer/account/edit/page.tsx` | 1, 13, 25, 48 | Updated presentation, district labels/selection/filtering, or shared validation; see review summary. No existing record rewritten. |
| `app/retailer/account/page.tsx` | 41, 77, 100 | Updated presentation, district labels/selection/filtering, or shared validation; see review summary. No existing record rewritten. |
| `app/retailer/checkout/page.tsx` | 73, 95, 102, 278 | Updated presentation, district labels/selection/filtering, or shared validation; see review summary. No existing record rewritten. |
| `app/retailer/orders/[id]/page.tsx` | 91, 143, 285 | Updated presentation, district labels/selection/filtering, or shared validation; see review summary. No existing record rewritten. |
| `components/admin/area-edit-form.tsx` | 11, 27, 28, 29, 30 | Updated presentation, district labels/selection/filtering, or shared validation; see review summary. No existing record rewritten. |
| `components/admin/area-form.tsx` | 8, 12, 22, 23, 24, 25 | Updated presentation, district labels/selection/filtering, or shared validation; see review summary. No existing record rewritten. |
| `components/admin/retailer-area-reassign-form.tsx` | 6 | Updated presentation, district labels/selection/filtering, or shared validation; see review summary. No existing record rewritten. |
| `components/areas/service-area-select.tsx` | 4, 8, 9, 14, 16, 17, 21, 22, 23, 25, 26 | Updated presentation, district labels/selection/filtering, or shared validation; see review summary. No existing record rewritten. |
| `components/auth/register-retailer-form.tsx` | 9 | Updated presentation, district labels/selection/filtering, or shared validation; see review summary. No existing record rewritten. |
| `components/retailer/address-form.tsx` | 21, 27, 28, 105, 106, 107 | Updated presentation, district labels/selection/filtering, or shared validation; see review summary. No existing record rewritten. |
| `docs/ANDROID_RELEASE_SIGNING.md` | 106 | Historical documentation/business context retained; does not assign retailers. |
| `docs/PREMIUM_REDESIGN_2026-10-10.md` | 1, 17, 26, 28, 40 | Historical documentation/business context retained; does not assign retailers. |
| `docs/SERVICE_AREA_SARAN.md` | 1, 7, 8, 9, 10, 14, 16, 17, 23, 25, 29, 30, 31, 35, 39 | Historical documentation/business context retained; does not assign retailers. |
| `lib/admin/master-data-actions.ts` | 3, 78, 85, 93, 117, 124 | Updated presentation, district labels/selection/filtering, or shared validation; see review summary. No existing record rewritten. |
| `lib/admin/retailers-actions.ts` | 135 | Updated presentation, district labels/selection/filtering, or shared validation; see review summary. No existing record rewritten. |
| `lib/areas/district.ts` | 3, 4, 5, 6, 9, 15, 20, 21, 24, 25, 27, 28 | Updated presentation, district labels/selection/filtering, or shared validation; see review summary. No existing record rewritten. |
| `lib/config/service-area.ts` | 2, 3, 5, 6, 8, 13, 16 | Saran/Bihar retained as business default; not a district allowlist. |
| `lib/mobile/commerce-service.ts` | 92, 141, 278, 331, 362, 378, 491, 532 | Native CRUD already uses shared address schema, session owner and stored district; now inherits shared validation. |
| `lib/retailer/address-actions.ts` | 62 | Existing owner-scoped persistence stores submitted district; RLS and explicit owner filter retained and tested. |
| `lib/retailer/address-shared.ts` | 2, 16, 20, 48, 72 | Updated presentation, district labels/selection/filtering, or shared validation; see review summary. No existing record rewritten. |
| `lib/retailer/checkout-actions.ts` | 59, 70 | Stored-district display, order snapshot, or area-ID data consumer retained; no default substitution/legacy rewrite. |
| `lib/retailer/order-actions.ts` | 215 | Stored-district display, order snapshot, or area-ID data consumer retained; no default substitution/legacy rewrite. |
| `lib/retailer/shopping-context.ts` | 12, 21, 26 | Stored-district display, order snapshot, or area-ID data consumer retained; no default substitution/legacy rewrite. |
| `package.json` | 5 | Historical documentation/business context retained; does not assign retailers. |
| `supabase/migrations/0001_init.sql` | 45, 46 | Preserved historical schema/default/rollback or area view; no migration run or data rewrite. 0058 remains default-only. |
| `supabase/migrations/0032_retailer_address_book.sql` | 32 | Preserved historical schema/default/rollback or area view; no migration run or data rewrite. 0058 remains default-only. |
| `supabase/migrations/0041_area_stock_view.sql` | 7 | Preserved historical schema/default/rollback or area view; no migration run or data rewrite. 0058 remains default-only. |
| `supabase/migrations/0058_saran_default_district.sql` | 2, 4, 7, 8, 11, 12, 14, 18, 20, 21 | Preserved historical schema/default/rollback or area view; no migration run or data rewrite. 0058 remains default-only. |
| `supabase/rollbacks/0058_saran_default_district.down.sql` | 4, 6, 7 | Preserved historical schema/default/rollback or area view; no migration run or data rewrite. 0058 remains default-only. |
| `tests/checkout-atomic.test.ts` | 15, 95, 96 | Regression/legacy fixtures retained; new district suites exercise selection, persistence, authorization and PostgreSQL RLS. |
| `tests/coins-refund-migration.test.ts` | 30 | Regression/legacy fixtures retained; new district suites exercise selection, persistence, authorization and PostgreSQL RLS. |
| `tests/district-management-db.test.ts` | 5, 9, 10, 11, 13, 16, 20, 21, 22, 23, 24, 26, 28, 29, 30, 33, 34, 35, 36, 37, 39, 46, 49, 50, 51, 54, 56, 59, 60, 61, 63, 67 | Regression/legacy fixtures retained; new district suites exercise selection, persistence, authorization and PostgreSQL RLS. |
| `tests/district-management-ui.test.tsx` | 15, 16, 17, 20, 21, 24, 27, 28, 30, 31, 33, 37, 39, 41, 47 | Regression/legacy fixtures retained; new district suites exercise selection, persistence, authorization and PostgreSQL RLS. |
| `tests/district-management.test.ts` | 2, 25, 27, 28, 30, 31, 32, 33, 34, 36, 37, 38, 39, 40, 41, 42, 44, 45, 47, 48, 49, 50, 55, 56, 58, 62, 63, 90, 93, 96, 99, 101, 103, 104, 109, 110, 111, 113, 116, 121, 126, 128, 129 | Regression/legacy fixtures retained; new district suites exercise selection, persistence, authorization and PostgreSQL RLS. |
| `tests/invoice-gst-split.test.ts` | 38 | Regression/legacy fixtures retained; new district suites exercise selection, persistence, authorization and PostgreSQL RLS. |
| `tests/mobile-address-crud.test.ts` | 23, 54, 55, 73 | Regression/legacy fixtures retained; new district suites exercise selection, persistence, authorization and PostgreSQL RLS. |
| `tests/mobile-address-routes.test.ts` | 34, 87, 92, 151, 170, 193, 198, 221 | Regression/legacy fixtures retained; new district suites exercise selection, persistence, authorization and PostgreSQL RLS. |
| `tests/mobile-auth.test.ts` | 494 | Regression/legacy fixtures retained; new district suites exercise selection, persistence, authorization and PostgreSQL RLS. |
| `tests/mobile-commerce-addresses.test.ts` | 42 | Regression/legacy fixtures retained; new district suites exercise selection, persistence, authorization and PostgreSQL RLS. |
| `tests/mobile-order-delivery.test.ts` | 69, 146 | Regression/legacy fixtures retained; new district suites exercise selection, persistence, authorization and PostgreSQL RLS. |
| `tests/mobile-order-invoice.test.ts` | 54, 98, 133, 166 | Regression/legacy fixtures retained; new district suites exercise selection, persistence, authorization and PostgreSQL RLS. |
| `tests/premium-upgrade.test.ts` | 59, 60, 71, 86 | Regression/legacy fixtures retained; new district suites exercise selection, persistence, authorization and PostgreSQL RLS. |
| `tests/retailer-enterprise-upgrade.test.ts` | 537 | Regression/legacy fixtures retained; new district suites exercise selection, persistence, authorization and PostgreSQL RLS. |
| `tests/retailer-home-auth.test.ts` | 13 | Regression/legacy fixtures retained; new district suites exercise selection, persistence, authorization and PostgreSQL RLS. |
| `tests/saran-district.test.ts` | 2, 6, 7, 8, 13, 18, 19, 31, 32, 33, 35, 36, 40, 43, 44, 68, 73, 77, 79, 80, 83, 84, 88, 95, 102, 108, 111, 113, 116, 117, 118, 119, 121, 124, 125, 126, 127, 129 | Regression/legacy fixtures retained; new district suites exercise selection, persistence, authorization and PostgreSQL RLS. |
| `tests/security-phase0-app.test.ts` | 218 | Regression/legacy fixtures retained; new district suites exercise selection, persistence, authorization and PostgreSQL RLS. |
| `tests/security-phase0-db.test.ts` | 399 | Regression/legacy fixtures retained; new district suites exercise selection, persistence, authorization and PostgreSQL RLS. |
| `tests/warehouse-resolver.test.ts` | 17 | Regression/legacy fixtures retained; new district suites exercise selection, persistence, authorization and PostgreSQL RLS. |
| `types/database.types.ts` | 65, 72, 835, 852 | Schema types unchanged: areas.district required, saved-address district nullable. |

## Indirect area-ID/label dependencies without a direct district keyword

These are the wider dependency search results, not claims that every operational feature was redesigned. They identify the existing pricing, stock, registration, authorization and delivery consumers whose area-ID contracts were preserved.

| Location | Lines | Disposition |
|---|---|---|
| `android/core/auth/src/main/kotlin/com/maharanitraders/core/auth/AuthRepository.kt` | 139, 150 | Existing area-ID consumer/security contract retained unless listed in the change summary. |
| `android/core/auth/src/main/kotlin/com/maharanitraders/core/auth/Registration.kt` | 19 | Existing area-ID consumer/security contract retained unless listed in the change summary. |
| `android/core/auth/src/main/kotlin/com/maharanitraders/core/auth/SessionManager.kt` | 328 | Existing area-ID consumer/security contract retained unless listed in the change summary. |
| `android/core/common/src/main/kotlin/com/maharanitraders/core/common/AppResult.kt` | 36 | Existing area-ID consumer/security contract retained unless listed in the change summary. |
| `android/feature/auth/src/main/kotlin/com/maharanitraders/feature/auth/AuthFormState.kt` | 84 | Existing area-ID consumer/security contract retained unless listed in the change summary. |
| `app/admin/banners/[id]/page.tsx` | 14, 52 | Existing area-ID consumer/security contract retained unless listed in the change summary. |
| `app/admin/banners/page.tsx` | 15, 30, 92 | Existing area-ID consumer/security contract retained unless listed in the change summary. |
| `app/admin/reports/page.tsx` | 84, 96, 114 | Existing area-ID consumer/security contract retained unless listed in the change summary. |
| `app/admin/team/[id]/page.tsx` | 19, 54, 99, 119 | Existing area-ID consumer/security contract retained unless listed in the change summary. |
| `app/admin/team/page.tsx` | 37, 107, 128 | Existing area-ID consumer/security contract retained unless listed in the change summary. |
| `app/admin/warehouses/[id]/page.tsx` | 9, 17, 36 | Existing area-ID consumer/security contract retained unless listed in the change summary. |
| `app/api/mobile/v1/cart/coupon/route.ts` | 34, 36, 41 | Existing area-ID consumer/security contract retained unless listed in the change summary. |
| `app/api/mobile/v1/catalog/products/route.ts` | 30 | Existing area-ID consumer/security contract retained unless listed in the change summary. |
| `app/api/mobile/v1/retailers/register/route.ts` | 53, 87, 104 | Existing area-ID consumer/security contract retained unless listed in the change summary. |
| `app/login/page.tsx` | 4, 23 | Existing area-ID consumer/security contract retained unless listed in the change summary. |
| `app/retailer/brands/[id]/page.tsx` | 35, 49 | Existing area-ID consumer/security contract retained unless listed in the change summary. |
| `app/retailer/cart/page.tsx` | 94, 96, 102, 139, 207 | Existing area-ID consumer/security contract retained unless listed in the change summary. |
| `app/retailer/catalog/[id]/page.tsx` | 152, 154, 195, 199, 203, 213 | Existing area-ID consumer/security contract retained unless listed in the change summary. |
| `app/retailer/catalog/page.tsx` | 70, 87, 133, 139 | Existing area-ID consumer/security contract retained unless listed in the change summary. |
| `app/retailer/favorites/page.tsx` | 15, 19 | Existing area-ID consumer/security contract retained unless listed in the change summary. |
| `app/retailer/home/page.tsx` | 14 | Existing area-ID consumer/security contract retained unless listed in the change summary. |
| `app/retailer/orders/[id]/reorder/page.tsx` | 65, 87 | Existing area-ID consumer/security contract retained unless listed in the change summary. |
| `app/retailer/quick-order/page.tsx` | 54, 56, 90 | Existing area-ID consumer/security contract retained unless listed in the change summary. |
| `app/salesman/orders/new/page.tsx` | 15, 53, 102 | Existing area-ID consumer/security contract retained unless listed in the change summary. |
| `app/salesman/profile/page.tsx` | 16, 32, 38, 39 | Existing area-ID consumer/security contract retained unless listed in the change summary. |
| `app/salesman/retailers/[id]/page.tsx` | 15, 39, 54 | Existing area-ID consumer/security contract retained unless listed in the change summary. |
| `app/salesman/retailers/page.tsx` | 30, 105, 116, 118, 125, 131, 132, 184 | Existing area-ID consumer/security contract retained unless listed in the change summary. |
| `components/admin/banner-edit-form.tsx` | 28, 40, 97, 98 | Existing area-ID consumer/security contract retained unless listed in the change summary. |
| `components/admin/banner-form.tsx` | 69, 70 | Existing area-ID consumer/security contract retained unless listed in the change summary. |
| `components/admin/price-list-form.tsx` | 69, 70 | Existing area-ID consumer/security contract retained unless listed in the change summary. |
| `components/admin/route-create-form.tsx` | 50, 51 | Existing area-ID consumer/security contract retained unless listed in the change summary. |
| `components/admin/staff-edit-form.tsx` | 22, 31, 64, 65 | Existing area-ID consumer/security contract retained unless listed in the change summary. |
| `components/admin/staff-form.tsx` | 53, 54 | Existing area-ID consumer/security contract retained unless listed in the change summary. |
| `components/admin/warehouse-edit-form.tsx` | 20, 26, 45, 46 | Existing area-ID consumer/security contract retained unless listed in the change summary. |
| `components/admin/warehouse-form.tsx` | 27, 28 | Existing area-ID consumer/security contract retained unless listed in the change summary. |
| `components/auth/auth-frame.tsx` | 3, 20 | Existing area-ID consumer/security contract retained unless listed in the change summary. |
| `components/layout/sidebar.tsx` | 7, 81 | Existing area-ID consumer/security contract retained unless listed in the change summary. |
| `components/retailer/home-content.tsx` | 22, 76, 77 | Existing area-ID consumer/security contract retained unless listed in the change summary. |
| `docs/PHASE1_AUDIT_FEATURE_MATRIX.md` | 486 | Existing area-ID consumer/security contract retained unless listed in the change summary. |
| `lib/admin/banners-actions.ts` | 33, 59, 67, 77, 107, 115, 125 | Existing area-ID consumer/security contract retained unless listed in the change summary. |
| `lib/admin/pricing-actions.ts` | 22, 37, 47, 58, 78 | Existing area-ID consumer/security contract retained unless listed in the change summary. |
| `lib/admin/routes-actions.ts` | 18, 27, 35 | Existing area-ID consumer/security contract retained unless listed in the change summary. |
| `lib/admin/team-actions.ts` | 22, 54, 60, 124, 127, 148, 163, 169, 184, 187 | Existing area-ID consumer/security contract retained unless listed in the change summary. |
| `lib/ai/tools/products.ts` | 56, 57, 83, 85 | Existing area-ID consumer/security contract retained unless listed in the change summary. |
| `lib/auth/actions.ts` | 303, 317, 330, 368, 384 | Existing area-ID consumer/security contract retained unless listed in the change summary. |
| `lib/coupons/actions.ts` | 38, 40, 42 | Existing area-ID consumer/security contract retained unless listed in the change summary. |
| `lib/coupons/cart-lines.ts` | 54, 74 | Existing area-ID consumer/security contract retained unless listed in the change summary. |
| `lib/mobile/auth-api.ts` | 81 | Existing area-ID consumer/security contract retained unless listed in the change summary. |
| `lib/mobile/catalog-service.ts` | 81, 87, 105, 109, 208, 214, 349, 361, 367, 506, 542, 549, 568 | Existing area-ID consumer/security contract retained unless listed in the change summary. |
| `lib/mobile/catalog.ts` | 104, 356, 384, 389 | Existing area-ID consumer/security contract retained unless listed in the change summary. |
| `lib/mobile/quick-order-service.ts` | 145, 147, 148, 165, 183 | Existing area-ID consumer/security contract retained unless listed in the change summary. |
| `lib/orders/quote-order.ts` | 129, 207, 245 | Existing area-ID consumer/security contract retained unless listed in the change summary. |
| `lib/retailer/banner-target.ts` | 121, 126, 132 | Existing area-ID consumer/security contract retained unless listed in the change summary. |
| `lib/retailer/brand-detail.ts` | 158, 211 | Existing area-ID consumer/security contract retained unless listed in the change summary. |
| `lib/retailer/bulk-order-actions.ts` | 63, 65, 101 | Existing area-ID consumer/security contract retained unless listed in the change summary. |
| `lib/retailer/cart-validation.ts` | 66, 68, 70 | Existing area-ID consumer/security contract retained unless listed in the change summary. |
| `lib/retailer/catalog-batches.ts` | 139, 145, 261, 276 | Existing area-ID consumer/security contract retained unless listed in the change summary. |
| `lib/retailer/catalog.ts` | 230, 237, 258, 261 | Existing area-ID consumer/security contract retained unless listed in the change summary. |
| `lib/retailer/effective-price.ts` | 55, 68, 85, 98, 100, 112, 114 | Existing area-ID consumer/security contract retained unless listed in the change summary. |
| `lib/retailer/home-data.ts` | 159, 172, 220, 249 | Existing area-ID consumer/security contract retained unless listed in the change summary. |
| `lib/retailer/personalization.ts` | 69, 79, 86, 108, 115, 149, 155, 180 | Existing area-ID consumer/security contract retained unless listed in the change summary. |
| `lib/retailer/search-actions.ts` | 113, 117 | Existing area-ID consumer/security contract retained unless listed in the change summary. |
| `lib/warehouse/resolver.ts` | 23, 33 | Existing area-ID consumer/security contract retained unless listed in the change summary. |
| `supabase/audits/phase0_privileged_accounts_readonly.sql` | 22, 48, 61, 99, 107, 111 | Existing area-ID consumer/security contract retained unless listed in the change summary. |
| `supabase/migrations/0011_fix_retailer_row_creation.sql` | 36, 42, 46 | Existing area-ID consumer/security contract retained unless listed in the change summary. |
| `supabase/migrations/0012_fix_registration_phone_conflict.sql` | 56, 62, 66 | Existing area-ID consumer/security contract retained unless listed in the change summary. |
| `supabase/migrations/0014_salesman_retailer_order_rls.sql` | 25, 35, 57 | Existing area-ID consumer/security contract retained unless listed in the change summary. |
| `supabase/migrations/0037_staff_scope_policies.sql` | 53, 57, 61, 86, 506, 517, 529, 543, 557 | Existing area-ID consumer/security contract retained unless listed in the change summary. |
| `supabase/migrations/0052_phase0_security_hardening.sql` | 114, 115, 145, 150, 152, 156, 160 | Existing area-ID consumer/security contract retained unless listed in the change summary. |
| `supabase/migrations/0056_mobile_checkout_atomic.sql` | 515, 799, 801, 827, 833 | Existing area-ID consumer/security contract retained unless listed in the change summary. |
| `tests/area-stock.test.ts` | 34 | Existing area-ID consumer/security contract retained unless listed in the change summary. |
| `tests/banners.test.tsx` | 71, 135, 136, 138 | Existing area-ID consumer/security contract retained unless listed in the change summary. |
| `tests/helpers/pg-harness.ts` | 164, 173, 202, 208, 210, 211, 214, 216, 224 | Existing area-ID consumer/security contract retained unless listed in the change summary. |
| `tests/mobile-cart-service.test.ts` | 69 | Existing area-ID consumer/security contract retained unless listed in the change summary. |
| `tests/mobile-catalog-api.test.ts` | 320, 689, 900, 939, 1065, 1069, 1070, 1236 | Existing area-ID consumer/security contract retained unless listed in the change summary. |
| `tests/mobile-catalog-search.test.ts` | 65, 241, 248 | Existing area-ID consumer/security contract retained unless listed in the change summary. |
| `tests/mobile-checkout-atomic-db.test.ts` | 50, 186, 187, 195, 196, 323, 377 | Existing area-ID consumer/security contract retained unless listed in the change summary. |
| `tests/mobile-commerce-api.test.ts` | 54, 93 | Existing area-ID consumer/security contract retained unless listed in the change summary. |
| `tests/mobile-quick-order.test.ts` | 86 | Existing area-ID consumer/security contract retained unless listed in the change summary. |
| `tests/premium-redesign.test.ts` | 93 | Existing area-ID consumer/security contract retained unless listed in the change summary. |
| `tests/product-detail-ui.test.ts` | 359 | Existing area-ID consumer/security contract retained unless listed in the change summary. |
| `tests/production-readiness.test.ts` | 168 | Existing area-ID consumer/security contract retained unless listed in the change summary. |
| `tests/retailer-home-actions.test.ts` | 21 | Existing area-ID consumer/security contract retained unless listed in the change summary. |
| `tests/retailer-home-data.test.ts` | 23, 151, 156, 213, 214, 215, 232, 243 | Existing area-ID consumer/security contract retained unless listed in the change summary. |
| `tests/retailer-piece-pricing.test.ts` | 276 | Existing area-ID consumer/security contract retained unless listed in the change summary. |
| `tests/simplified-pack-stock-db.test.ts` | 24, 26, 27, 94, 95, 97, 98, 115 | Existing area-ID consumer/security contract retained unless listed in the change summary. |
| `tests/tools.test.ts` | 17 | Existing area-ID consumer/security contract retained unless listed in the change summary. |
| `tests/variant-size-selector.test.ts` | 242 | Existing area-ID consumer/security contract retained unless listed in the change summary. |
| `tests/variant-switcher.test.ts` | 172 | Existing area-ID consumer/security contract retained unless listed in the change summary. |
