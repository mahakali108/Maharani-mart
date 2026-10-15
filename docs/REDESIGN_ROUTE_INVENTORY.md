# Route inventory — 14 October 2026

Inventory of actual App Router pages, handlers, layouts and boundaries. Routes with dynamic segments use their literal source names. This is a scope/source inventory, **not** a claim of authenticated browser verification for every row.

Major new compositions: storefront hero, authentication frame, catalogue navigation and checkout progress. Secondary pages generally receive shared typography/panels and existing functional layouts are preserved. See `REDESIGN_DISTRICT_REVIEW.md` for measured checks and limitations.

| Route / segment | Implementation | Scope |
|---|---|---|
| `/access-expired` | `app/access-expired/page.tsx` | Public/auth/state presentation updated |
| `/admin/ai` | `app/admin/ai/page.tsx` | Operational page preserved; shared tokens only (not redesigned) |
| `/admin/areas/[id]` | `app/admin/areas/[id]/page.tsx` | District/retailer management UI and directory/filter changes |
| `/admin/areas` | `app/admin/areas/page.tsx` | District/retailer management UI and directory/filter changes |
| `/admin/attendance` | `app/admin/attendance/page.tsx` | Operational page preserved; shared tokens only (not redesigned) |
| `/admin/audit-logs` | `app/admin/audit-logs/page.tsx` | Operational page preserved; shared tokens only (not redesigned) |
| `/admin/banners/[id]` | `app/admin/banners/[id]/page.tsx` | Operational page preserved; shared tokens only (not redesigned) |
| `/admin/banners` | `app/admin/banners/page.tsx` | Operational page preserved; shared tokens only (not redesigned) |
| `/admin/catalog/brands/[id]` | `app/admin/catalog/brands/[id]/page.tsx` | Operational page preserved; shared tokens only (not redesigned) |
| `/admin/catalog/brands` | `app/admin/catalog/brands/page.tsx` | Operational page preserved; shared tokens only (not redesigned) |
| `/admin/catalog/categories/[id]` | `app/admin/catalog/categories/[id]/page.tsx` | Operational page preserved; shared tokens only (not redesigned) |
| `/admin/catalog/categories` | `app/admin/catalog/categories/page.tsx` | Operational page preserved; shared tokens only (not redesigned) |
| `/admin/catalog` | `app/admin/catalog/error.tsx` | Operational page preserved; shared tokens only (not redesigned) |
| `/admin/catalog` | `app/admin/catalog/loading.tsx` | Operational page preserved; shared tokens only (not redesigned) |
| `/admin/catalog` | `app/admin/catalog/page.tsx` | Operational page preserved; shared tokens only (not redesigned) |
| `/admin/cleanup` | `app/admin/cleanup/page.tsx` | Operational page preserved; shared tokens only (not redesigned) |
| `/admin/collections` | `app/admin/collections/page.tsx` | Operational page preserved; shared tokens only (not redesigned) |
| `/admin/command-center` | `app/admin/command-center/error.tsx` | Operational page preserved; shared tokens only (not redesigned) |
| `/admin/command-center` | `app/admin/command-center/loading.tsx` | Operational page preserved; shared tokens only (not redesigned) |
| `/admin/command-center` | `app/admin/command-center/page.tsx` | Operational page preserved; shared tokens only (not redesigned) |
| `/admin/commissions` | `app/admin/commissions/page.tsx` | Operational page preserved; shared tokens only (not redesigned) |
| `/admin/control-center` | `app/admin/control-center/page.tsx` | Operational page preserved; shared tokens only (not redesigned) |
| `/admin/control-center/users/[id]` | `app/admin/control-center/users/[id]/page.tsx` | Operational page preserved; shared tokens only (not redesigned) |
| `/admin/coupons/[id]` | `app/admin/coupons/[id]/page.tsx` | Operational page preserved; shared tokens only (not redesigned) |
| `/admin/coupons/new` | `app/admin/coupons/new/page.tsx` | Operational page preserved; shared tokens only (not redesigned) |
| `/admin/coupons` | `app/admin/coupons/page.tsx` | Operational page preserved; shared tokens only (not redesigned) |
| `/admin/dashboard` | `app/admin/dashboard/loading.tsx` | Operational page preserved; shared tokens only (not redesigned) |
| `/admin/dashboard` | `app/admin/dashboard/page.tsx` | Operational page preserved; shared tokens only (not redesigned) |
| `/admin/delivered/[orderId]` | `app/admin/delivered/[orderId]/page.tsx` | Operational page preserved; shared tokens only (not redesigned) |
| `/admin/delivered/export` | `app/admin/delivered/export/route.ts` | API/download: contract preserved; not a visual page |
| `/admin/delivered` | `app/admin/delivered/page.tsx` | Operational page preserved; shared tokens only (not redesigned) |
| `/admin` | `app/admin/error.tsx` | Operational page preserved; shared tokens only (not redesigned) |
| `/admin/follow-ups` | `app/admin/follow-ups/page.tsx` | Operational page preserved; shared tokens only (not redesigned) |
| `/admin/inventory/batches` | `app/admin/inventory/batches/page.tsx` | Operational page preserved; shared tokens only (not redesigned) |
| `/admin/inventory/expiry` | `app/admin/inventory/expiry/page.tsx` | Operational page preserved; shared tokens only (not redesigned) |
| `/admin/inventory/forecast` | `app/admin/inventory/forecast/page.tsx` | Operational page preserved; shared tokens only (not redesigned) |
| `/admin/inventory/grn/[id]` | `app/admin/inventory/grn/[id]/page.tsx` | Operational page preserved; shared tokens only (not redesigned) |
| `/admin/inventory/grn/new` | `app/admin/inventory/grn/new/page.tsx` | Operational page preserved; shared tokens only (not redesigned) |
| `/admin/inventory/grn` | `app/admin/inventory/grn/page.tsx` | Operational page preserved; shared tokens only (not redesigned) |
| `/admin/inventory/ledger` | `app/admin/inventory/ledger/page.tsx` | Operational page preserved; shared tokens only (not redesigned) |
| `/admin/inventory/low-stock` | `app/admin/inventory/low-stock/page.tsx` | Operational page preserved; shared tokens only (not redesigned) |
| `/admin/inventory/movements` | `app/admin/inventory/movements/page.tsx` | Operational page preserved; shared tokens only (not redesigned) |
| `/admin/inventory` | `app/admin/inventory/page.tsx` | Operational page preserved; shared tokens only (not redesigned) |
| `/admin/inventory/products` | `app/admin/inventory/products/page.tsx` | Operational page preserved; shared tokens only (not redesigned) |
| `/admin/inventory/reports/export` | `app/admin/inventory/reports/export/route.ts` | API/download: contract preserved; not a visual page |
| `/admin/inventory/reports` | `app/admin/inventory/reports/page.tsx` | Operational page preserved; shared tokens only (not redesigned) |
| `/admin/inventory/transfers` | `app/admin/inventory/transfers/page.tsx` | Operational page preserved; shared tokens only (not redesigned) |
| `/admin` | `app/admin/layout.tsx` | Operational page preserved; shared tokens only (not redesigned) |
| `/admin` | `app/admin/loading.tsx` | Operational page preserved; shared tokens only (not redesigned) |
| `/admin/notifications` | `app/admin/notifications/page.tsx` | Operational page preserved; shared tokens only (not redesigned) |
| `/admin/orders/[id]` | `app/admin/orders/[id]/page.tsx` | Operational page preserved; shared tokens only (not redesigned) |
| `/admin/orders` | `app/admin/orders/page.tsx` | Operational page preserved; shared tokens only (not redesigned) |
| `/admin/pricing` | `app/admin/pricing/page.tsx` | Operational page preserved; shared tokens only (not redesigned) |
| `/admin/pricing/schemes` | `app/admin/pricing/schemes/page.tsx` | Operational page preserved; shared tokens only (not redesigned) |
| `/admin/products/[id]` | `app/admin/products/[id]/page.tsx` | Operational page preserved; shared tokens only (not redesigned) |
| `/admin/products` | `app/admin/products/error.tsx` | Operational page preserved; shared tokens only (not redesigned) |
| `/admin/products/export` | `app/admin/products/export/route.ts` | API/download: contract preserved; not a visual page |
| `/admin/products/import` | `app/admin/products/import/page.tsx` | Operational page preserved; shared tokens only (not redesigned) |
| `/admin/products/import/template` | `app/admin/products/import/template/route.ts` | API/download: contract preserved; not a visual page |
| `/admin/products` | `app/admin/products/loading.tsx` | Operational page preserved; shared tokens only (not redesigned) |
| `/admin/products/new` | `app/admin/products/new/page.tsx` | Operational page preserved; shared tokens only (not redesigned) |
| `/admin/products` | `app/admin/products/page.tsx` | Operational page preserved; shared tokens only (not redesigned) |
| `/admin/reports/barcodes` | `app/admin/reports/barcodes/route.ts` | API/download: contract preserved; not a visual page |
| `/admin/reports` | `app/admin/reports/page.tsx` | Operational page preserved; shared tokens only (not redesigned) |
| `/admin/retailers/[id]` | `app/admin/retailers/[id]/page.tsx` | District/retailer management UI and directory/filter changes |
| `/admin/retailers` | `app/admin/retailers/page.tsx` | District/retailer management UI and directory/filter changes |
| `/admin/returns` | `app/admin/returns/page.tsx` | Operational page preserved; shared tokens only (not redesigned) |
| `/admin/routes/[id]` | `app/admin/routes/[id]/page.tsx` | Operational page preserved; shared tokens only (not redesigned) |
| `/admin/routes` | `app/admin/routes/page.tsx` | Operational page preserved; shared tokens only (not redesigned) |
| `/admin/support/[id]` | `app/admin/support/[id]/page.tsx` | Operational page preserved; shared tokens only (not redesigned) |
| `/admin/support` | `app/admin/support/page.tsx` | Operational page preserved; shared tokens only (not redesigned) |
| `/admin/targets` | `app/admin/targets/page.tsx` | Operational page preserved; shared tokens only (not redesigned) |
| `/admin/team/[id]` | `app/admin/team/[id]/page.tsx` | Operational page preserved; shared tokens only (not redesigned) |
| `/admin/team/new` | `app/admin/team/new/page.tsx` | Operational page preserved; shared tokens only (not redesigned) |
| `/admin/team` | `app/admin/team/page.tsx` | Operational page preserved; shared tokens only (not redesigned) |
| `/admin/visits` | `app/admin/visits/page.tsx` | Operational page preserved; shared tokens only (not redesigned) |
| `/admin/wallets/[id]` | `app/admin/wallets/[id]/page.tsx` | Operational page preserved; shared tokens only (not redesigned) |
| `/admin/wallets` | `app/admin/wallets/page.tsx` | Operational page preserved; shared tokens only (not redesigned) |
| `/admin/warehouses/[id]` | `app/admin/warehouses/[id]/page.tsx` | Operational page preserved; shared tokens only (not redesigned) |
| `/admin/warehouses` | `app/admin/warehouses/page.tsx` | Operational page preserved; shared tokens only (not redesigned) |
| `/api/admin/storage-report` | `app/api/admin/storage-report/route.ts` | API/download: contract preserved; not a visual page |
| `/api/ai/chat` | `app/api/ai/chat/route.ts` | API/download: contract preserved; not a visual page |
| `/api/ai/memory` | `app/api/ai/memory/route.ts` | API/download: contract preserved; not a visual page |
| `/api/cron/cleanup` | `app/api/cron/cleanup/route.ts` | API/download: contract preserved; not a visual page |
| `/api/health` | `app/api/health/route.ts` | API/download: contract preserved; not a visual page |
| `/api/mobile/v1/account/requests` | `app/api/mobile/v1/account/requests/route.ts` | API/download: contract preserved; not a visual page |
| `/api/mobile/v1/addresses/[addressId]/default` | `app/api/mobile/v1/addresses/[addressId]/default/route.ts` | API/download: contract preserved; not a visual page |
| `/api/mobile/v1/addresses/[addressId]` | `app/api/mobile/v1/addresses/[addressId]/route.ts` | API/download: contract preserved; not a visual page |
| `/api/mobile/v1/addresses` | `app/api/mobile/v1/addresses/route.ts` | API/download: contract preserved; not a visual page |
| `/api/mobile/v1/areas` | `app/api/mobile/v1/areas/route.ts` | API/download: contract preserved; not a visual page |
| `/api/mobile/v1/auth/login` | `app/api/mobile/v1/auth/login/route.ts` | API/download: contract preserved; not a visual page |
| `/api/mobile/v1/auth/logout-all` | `app/api/mobile/v1/auth/logout-all/route.ts` | API/download: contract preserved; not a visual page |
| `/api/mobile/v1/auth/logout` | `app/api/mobile/v1/auth/logout/route.ts` | API/download: contract preserved; not a visual page |
| `/api/mobile/v1/auth/password-change` | `app/api/mobile/v1/auth/password-change/route.ts` | API/download: contract preserved; not a visual page |
| `/api/mobile/v1/auth/password-reset` | `app/api/mobile/v1/auth/password-reset/route.ts` | API/download: contract preserved; not a visual page |
| `/api/mobile/v1/auth/password-update` | `app/api/mobile/v1/auth/password-update/route.ts` | API/download: contract preserved; not a visual page |
| `/api/mobile/v1/auth/refresh` | `app/api/mobile/v1/auth/refresh/route.ts` | API/download: contract preserved; not a visual page |
| `/api/mobile/v1/cart/coupon` | `app/api/mobile/v1/cart/coupon/route.ts` | API/download: contract preserved; not a visual page |
| `/api/mobile/v1/cart/lines/[lineId]` | `app/api/mobile/v1/cart/lines/[lineId]/route.ts` | API/download: contract preserved; not a visual page |
| `/api/mobile/v1/cart/lines` | `app/api/mobile/v1/cart/lines/route.ts` | API/download: contract preserved; not a visual page |
| `/api/mobile/v1/cart` | `app/api/mobile/v1/cart/route.ts` | API/download: contract preserved; not a visual page |
| `/api/mobile/v1/catalog/brands` | `app/api/mobile/v1/catalog/brands/route.ts` | API/download: contract preserved; not a visual page |
| `/api/mobile/v1/catalog/categories` | `app/api/mobile/v1/catalog/categories/route.ts` | API/download: contract preserved; not a visual page |
| `/api/mobile/v1/catalog/products/[id]` | `app/api/mobile/v1/catalog/products/[id]/route.ts` | API/download: contract preserved; not a visual page |
| `/api/mobile/v1/catalog/products` | `app/api/mobile/v1/catalog/products/route.ts` | API/download: contract preserved; not a visual page |
| `/api/mobile/v1/catalog/search` | `app/api/mobile/v1/catalog/search/route.ts` | API/download: contract preserved; not a visual page |
| `/api/mobile/v1/checkout/quote` | `app/api/mobile/v1/checkout/quote/route.ts` | API/download: contract preserved; not a visual page |
| `/api/mobile/v1/coupons` | `app/api/mobile/v1/coupons/route.ts` | API/download: contract preserved; not a visual page |
| `/api/mobile/v1/favorites` | `app/api/mobile/v1/favorites/route.ts` | API/download: contract preserved; not a visual page |
| `/api/mobile/v1/health` | `app/api/mobile/v1/health/route.ts` | API/download: contract preserved; not a visual page |
| `/api/mobile/v1/help` | `app/api/mobile/v1/help/route.ts` | API/download: contract preserved; not a visual page |
| `/api/mobile/v1/home` | `app/api/mobile/v1/home/route.ts` | API/download: contract preserved; not a visual page |
| `/api/mobile/v1/notifications/preferences` | `app/api/mobile/v1/notifications/preferences/route.ts` | API/download: contract preserved; not a visual page |
| `/api/mobile/v1/notifications/read` | `app/api/mobile/v1/notifications/read/route.ts` | API/download: contract preserved; not a visual page |
| `/api/mobile/v1/notifications` | `app/api/mobile/v1/notifications/route.ts` | API/download: contract preserved; not a visual page |
| `/api/mobile/v1/orders/[id]/cancel` | `app/api/mobile/v1/orders/[id]/cancel/route.ts` | API/download: contract preserved; not a visual page |
| `/api/mobile/v1/orders/[id]/delivery` | `app/api/mobile/v1/orders/[id]/delivery/route.ts` | API/download: contract preserved; not a visual page |
| `/api/mobile/v1/orders/[id]/invoice` | `app/api/mobile/v1/orders/[id]/invoice/route.ts` | API/download: contract preserved; not a visual page |
| `/api/mobile/v1/orders/[id]/return` | `app/api/mobile/v1/orders/[id]/return/route.ts` | API/download: contract preserved; not a visual page |
| `/api/mobile/v1/orders/[id]` | `app/api/mobile/v1/orders/[id]/route.ts` | API/download: contract preserved; not a visual page |
| `/api/mobile/v1/orders/requests/[requestKey]` | `app/api/mobile/v1/orders/requests/[requestKey]/route.ts` | API/download: contract preserved; not a visual page |
| `/api/mobile/v1/orders` | `app/api/mobile/v1/orders/route.ts` | API/download: contract preserved; not a visual page |
| `/api/mobile/v1/profile` | `app/api/mobile/v1/profile/route.ts` | API/download: contract preserved; not a visual page |
| `/api/mobile/v1/quick-order/match` | `app/api/mobile/v1/quick-order/match/route.ts` | API/download: contract preserved; not a visual page |
| `/api/mobile/v1/quick-order` | `app/api/mobile/v1/quick-order/route.ts` | API/download: contract preserved; not a visual page |
| `/api/mobile/v1/reports` | `app/api/mobile/v1/reports/route.ts` | API/download: contract preserved; not a visual page |
| `/api/mobile/v1/reports/statement` | `app/api/mobile/v1/reports/statement/route.ts` | API/download: contract preserved; not a visual page |
| `/api/mobile/v1/retailers/register` | `app/api/mobile/v1/retailers/register/route.ts` | API/download: contract preserved; not a visual page |
| `/api/mobile/v1/saved-carts/[id]/restore` | `app/api/mobile/v1/saved-carts/[id]/restore/route.ts` | API/download: contract preserved; not a visual page |
| `/api/mobile/v1/saved-carts/[id]` | `app/api/mobile/v1/saved-carts/[id]/route.ts` | API/download: contract preserved; not a visual page |
| `/api/mobile/v1/saved-carts/items/[itemId]/restore` | `app/api/mobile/v1/saved-carts/items/[itemId]/restore/route.ts` | API/download: contract preserved; not a visual page |
| `/api/mobile/v1/saved-carts/items/[itemId]` | `app/api/mobile/v1/saved-carts/items/[itemId]/route.ts` | API/download: contract preserved; not a visual page |
| `/api/mobile/v1/saved-carts/items` | `app/api/mobile/v1/saved-carts/items/route.ts` | API/download: contract preserved; not a visual page |
| `/api/mobile/v1/saved-carts` | `app/api/mobile/v1/saved-carts/route.ts` | API/download: contract preserved; not a visual page |
| `/api/mobile/v1/schemes` | `app/api/mobile/v1/schemes/route.ts` | API/download: contract preserved; not a visual page |
| `/api/mobile/v1/session` | `app/api/mobile/v1/session/route.ts` | API/download: contract preserved; not a visual page |
| `/api/mobile/v1/support/tickets/[id]` | `app/api/mobile/v1/support/tickets/[id]/route.ts` | API/download: contract preserved; not a visual page |
| `/api/mobile/v1/support/tickets` | `app/api/mobile/v1/support/tickets/route.ts` | API/download: contract preserved; not a visual page |
| `/api/mobile/v1/wallet/ledger` | `app/api/mobile/v1/wallet/ledger/route.ts` | API/download: contract preserved; not a visual page |
| `/api/mobile/v1/wallet` | `app/api/mobile/v1/wallet/route.ts` | API/download: contract preserved; not a visual page |
| `/api/webhooks` | `app/api/webhooks/route.ts` | API/download: contract preserved; not a visual page |
| `/auth/callback` | `app/auth/callback/route.ts` | API/download: contract preserved; not a visual page |
| `/` | `app/error.tsx` | Public/auth/state presentation updated |
| `/forgot-password` | `app/forgot-password/page.tsx` | Public/auth/state presentation updated |
| `/` | `app/global-error.tsx` | Existing implementation retained; shared theme where applicable |
| `/` | `app/layout.tsx` | Public/auth/state presentation updated |
| `/` | `app/loading.tsx` | Existing implementation retained; shared theme where applicable |
| `/login` | `app/login/page.tsx` | Public/auth/state presentation updated |
| `/` | `app/not-found.tsx` | Public/auth/state presentation updated |
| `/` | `app/page.tsx` | Role-based redirect retained |
| `/pending-approval` | `app/pending-approval/page.tsx` | Public/auth/state presentation updated |
| `/register-retailer` | `app/register-retailer/page.tsx` | Public/auth/state presentation updated |
| `/reset-password` | `app/reset-password/page.tsx` | Public/auth/state presentation updated |
| `/retailer/account/addresses` | `app/retailer/account/addresses/page.tsx` | Direct page/component presentation change; shared retailer shell/theme applies |
| `/retailer/account/edit` | `app/retailer/account/edit/page.tsx` | Direct page/component presentation change; shared retailer shell/theme applies |
| `/retailer/account/ledger` | `app/retailer/account/ledger/page.tsx` | Direct page/component presentation change; shared retailer shell/theme applies |
| `/retailer/account` | `app/retailer/account/loading.tsx` | Retained loader/boundary; consumes shared theme/components (not individually rebuilt) |
| `/retailer/account/notification-preferences` | `app/retailer/account/notification-preferences/page.tsx` | Direct page/component presentation change; shared retailer shell/theme applies |
| `/retailer/account` | `app/retailer/account/page.tsx` | Direct page/component presentation change; shared retailer shell/theme applies |
| `/retailer/account/security` | `app/retailer/account/security/page.tsx` | Direct page/component presentation change; shared retailer shell/theme applies |
| `/retailer/ai` | `app/retailer/ai/page.tsx` | Copy and shared shell only; chat layout not rebuilt |
| `/retailer/brands/[id]` | `app/retailer/brands/[id]/loading.tsx` | Retained loader/boundary; consumes shared theme/components (not individually rebuilt) |
| `/retailer/brands/[id]` | `app/retailer/brands/[id]/page.tsx` | Direct page/component presentation change; shared retailer shell/theme applies |
| `/retailer/brands` | `app/retailer/brands/page.tsx` | Direct page/component presentation change; shared retailer shell/theme applies |
| `/retailer/cart` | `app/retailer/cart/error.tsx` | Direct page/component presentation change; shared retailer shell/theme applies |
| `/retailer/cart` | `app/retailer/cart/loading.tsx` | Retained loader/boundary; consumes shared theme/components (not individually rebuilt) |
| `/retailer/cart` | `app/retailer/cart/page.tsx` | Direct page/component presentation change; shared retailer shell/theme applies |
| `/retailer/cart/saved` | `app/retailer/cart/saved/page.tsx` | Direct page/component presentation change; shared retailer shell/theme applies |
| `/retailer/catalog/[id]` | `app/retailer/catalog/[id]/loading.tsx` | Retained loader/boundary; consumes shared theme/components (not individually rebuilt) |
| `/retailer/catalog/[id]` | `app/retailer/catalog/[id]/page.tsx` | Direct page/component presentation change; shared retailer shell/theme applies |
| `/retailer/catalog` | `app/retailer/catalog/page.tsx` | Direct page/component presentation change; shared retailer shell/theme applies |
| `/retailer/categories/[id]` | `app/retailer/categories/[id]/loading.tsx` | Retained loader/boundary; consumes shared theme/components (not individually rebuilt) |
| `/retailer/categories/[id]` | `app/retailer/categories/[id]/page.tsx` | Direct page/component presentation change; shared retailer shell/theme applies |
| `/retailer/categories` | `app/retailer/categories/page.tsx` | Direct page/component presentation change; shared retailer shell/theme applies |
| `/retailer/checkout` | `app/retailer/checkout/page.tsx` | Direct page/component presentation change; shared retailer shell/theme applies |
| `/retailer/coupons` | `app/retailer/coupons/loading.tsx` | Retained loader/boundary; consumes shared theme/components (not individually rebuilt) |
| `/retailer/coupons` | `app/retailer/coupons/page.tsx` | Direct page/component presentation change; shared retailer shell/theme applies |
| `/retailer` | `app/retailer/error.tsx` | Direct page/component presentation change; shared retailer shell/theme applies |
| `/retailer/favorites` | `app/retailer/favorites/page.tsx` | Direct page/component presentation change; shared retailer shell/theme applies |
| `/retailer/help` | `app/retailer/help/page.tsx` | Direct page/component presentation change; shared retailer shell/theme applies |
| `/retailer/home` | `app/retailer/home/loading.tsx` | Direct page/component presentation change; shared retailer shell/theme applies |
| `/retailer/home` | `app/retailer/home/page.tsx` | Real HomeContent, navigation, cards and search updated; loader retained |
| `/retailer` | `app/retailer/layout.tsx` | Retained loader/boundary; consumes shared theme/components (not individually rebuilt) |
| `/retailer` | `app/retailer/loading.tsx` | Retained loader/boundary; consumes shared theme/components (not individually rebuilt) |
| `/retailer/notifications` | `app/retailer/notifications/page.tsx` | Direct page/component presentation change; shared retailer shell/theme applies |
| `/retailer/orders/[id]/delivery` | `app/retailer/orders/[id]/delivery/page.tsx` | Direct page/component presentation change; shared retailer shell/theme applies |
| `/retailer/orders/[id]/invoice/download` | `app/retailer/orders/[id]/invoice/download/route.ts` | API/download: contract preserved; not a visual page |
| `/retailer/orders/[id]/invoice` | `app/retailer/orders/[id]/invoice/page.tsx` | Direct page/component presentation change; shared retailer shell/theme applies |
| `/retailer/orders/[id]` | `app/retailer/orders/[id]/page.tsx` | Direct page/component presentation change; shared retailer shell/theme applies |
| `/retailer/orders/[id]/reorder` | `app/retailer/orders/[id]/reorder/page.tsx` | Direct page/component presentation change; shared retailer shell/theme applies |
| `/retailer/orders` | `app/retailer/orders/page.tsx` | Direct page/component presentation change; shared retailer shell/theme applies |
| `/retailer/quick-order` | `app/retailer/quick-order/page.tsx` | Direct page/component presentation change; shared retailer shell/theme applies |
| `/retailer/reports` | `app/retailer/reports/page.tsx` | Direct page/component presentation change; shared retailer shell/theme applies |
| `/retailer/reports/statement` | `app/retailer/reports/statement/route.ts` | API/download: contract preserved; not a visual page |
| `/retailer/schemes` | `app/retailer/schemes/page.tsx` | Direct page/component presentation change; shared retailer shell/theme applies |
| `/retailer/support/[id]` | `app/retailer/support/[id]/page.tsx` | Direct page/component presentation change; shared retailer shell/theme applies |
| `/retailer/support/new` | `app/retailer/support/new/page.tsx` | Direct page/component presentation change; shared retailer shell/theme applies |
| `/retailer/support` | `app/retailer/support/page.tsx` | Direct page/component presentation change; shared retailer shell/theme applies |
| `/salesman/ai` | `app/salesman/ai/page.tsx` | Operational page preserved; shared tokens only (not redesigned) |
| `/salesman/attendance` | `app/salesman/attendance/page.tsx` | Operational page preserved; shared tokens only (not redesigned) |
| `/salesman/collections` | `app/salesman/collections/page.tsx` | Operational page preserved; shared tokens only (not redesigned) |
| `/salesman/commissions` | `app/salesman/commissions/page.tsx` | Operational page preserved; shared tokens only (not redesigned) |
| `/salesman/dashboard` | `app/salesman/dashboard/page.tsx` | Operational page preserved; shared tokens only (not redesigned) |
| `/salesman/dcr` | `app/salesman/dcr/page.tsx` | Operational page preserved; shared tokens only (not redesigned) |
| `/salesman/deliveries/[orderId]` | `app/salesman/deliveries/[orderId]/page.tsx` | Operational page preserved; shared tokens only (not redesigned) |
| `/salesman/deliveries` | `app/salesman/deliveries/page.tsx` | Operational page preserved; shared tokens only (not redesigned) |
| `/salesman` | `app/salesman/error.tsx` | Operational page preserved; shared tokens only (not redesigned) |
| `/salesman/follow-ups` | `app/salesman/follow-ups/page.tsx` | Operational page preserved; shared tokens only (not redesigned) |
| `/salesman` | `app/salesman/layout.tsx` | Operational page preserved; shared tokens only (not redesigned) |
| `/salesman` | `app/salesman/loading.tsx` | Operational page preserved; shared tokens only (not redesigned) |
| `/salesman/orders/[id]` | `app/salesman/orders/[id]/page.tsx` | Operational page preserved; shared tokens only (not redesigned) |
| `/salesman/orders/new` | `app/salesman/orders/new/page.tsx` | Operational page preserved; shared tokens only (not redesigned) |
| `/salesman/orders` | `app/salesman/orders/page.tsx` | Operational page preserved; shared tokens only (not redesigned) |
| `/salesman/profile` | `app/salesman/profile/page.tsx` | Operational page preserved; shared tokens only (not redesigned) |
| `/salesman/retailers/[id]` | `app/salesman/retailers/[id]/page.tsx` | Operational page preserved; shared tokens only (not redesigned) |
| `/salesman/retailers` | `app/salesman/retailers/page.tsx` | Operational page preserved; shared tokens only (not redesigned) |
| `/salesman/routes` | `app/salesman/routes/page.tsx` | Operational page preserved; shared tokens only (not redesigned) |
| `/salesman/targets` | `app/salesman/targets/page.tsx` | Operational page preserved; shared tokens only (not redesigned) |
| `/salesman/visits` | `app/salesman/visits/page.tsx` | Operational page preserved; shared tokens only (not redesigned) |
| `/staff/ai` | `app/staff/ai/page.tsx` | Operational page preserved; shared tokens only (not redesigned) |
| `/staff/dashboard` | `app/staff/dashboard/page.tsx` | Operational page preserved; shared tokens only (not redesigned) |
| `/staff/deliveries/[orderId]` | `app/staff/deliveries/[orderId]/page.tsx` | Operational page preserved; shared tokens only (not redesigned) |
| `/staff/deliveries` | `app/staff/deliveries/page.tsx` | Operational page preserved; shared tokens only (not redesigned) |
| `/staff/inventory/ledger` | `app/staff/inventory/ledger/page.tsx` | Operational page preserved; shared tokens only (not redesigned) |
| `/staff/inventory` | `app/staff/inventory/page.tsx` | Operational page preserved; shared tokens only (not redesigned) |
| `/staff` | `app/staff/layout.tsx` | Operational page preserved; shared tokens only (not redesigned) |
| `/staff/orders/[id]` | `app/staff/orders/[id]/page.tsx` | Operational page preserved; shared tokens only (not redesigned) |
| `/staff/orders` | `app/staff/orders/page.tsx` | Operational page preserved; shared tokens only (not redesigned) |
| `/unauthorized` | `app/unauthorized/page.tsx` | Public/auth/state presentation updated |
