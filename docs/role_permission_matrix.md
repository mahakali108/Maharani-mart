# Role Permission Matrix

Enforced in two places, kept in sync deliberately:

1. **Postgres RLS** — `supabase/migrations/0001_init.sql` — the real, unbypassable boundary.
2. **`lib/permissions/permissions.ts`** — app-level checks used to hide/disable UI and guard Server Actions before they even attempt a write.

If you change one, change the other. Neither alone is sufficient: RLS without app-level checks means the UI will show actions that silently fail; app-level checks without RLS mean a direct API call could bypass the UI entirely.

| Capability | Super Admin | Admin | Staff | Salesman | Retailer |
|---|:---:|:---:|:---:|:---:|:---:|
| View products | ✅ | ✅ | ✅ | ✅ | ✅ |
| Create / edit products | ✅ | ✅ | ✅ | ❌ | ❌ |
| Delete products | ✅ | ✅ | ❌ | ❌ | ❌ |
| Manage categories & brands (create / edit / activate / deactivate) | ✅ | ✅ | ✅ | ❌ | ❌ |
| Delete categories & brands | ✅ | ✅ | ❌ | ❌ | ❌ |
| Manage pricing & schemes | ✅ | ✅ | ❌ | ❌ | ❌ |
| View inventory | ✅ | ✅ | ✅ | ❌ | ❌ |
| Manage inventory (stock movements) | ✅ | ✅ | ✅ | ❌ | ❌ |
| Batches / expiry / GRN / transfers (0017) | ✅ | ✅ | ✅ | ❌ | ❌ |
| Edit inventory settings (expiry windows) | ✅ | ✅ | ❌ | ❌ | ❌ |
| View all orders | ✅ | ✅ | ✅ | ❌ | ❌ |
| View own orders | — | — | — | ✅ | ✅ |
| Create orders (on behalf of retailer) | ✅ | ✅ | ✅ | ✅ | — |
| Place own orders | ❌ | ❌ | ❌ | ❌ | ✅ |
| Approve / process orders | ✅ | ✅ | ✅ | ❌ | ❌ |
| View retailers | ✅ | ✅ | ✅ | ✅ (own) | — |
| Approve retailer registration | ✅ | ✅ | ❌ | ❌ | ❌ |
| Suspend retailer | ✅ | ✅ | ❌ | ❌ | ❌ |
| Assign / reassign retailer to salesman | ✅ | ✅ | ❌ | ❌ | ❌ |
| Manage staff / salesman accounts | ✅ | ❌ | ❌ | ❌ | ❌ |
| Manage banners | ✅ | ✅ | ✅ | ❌ | ❌ |
| View admin dashboard | ✅ | ✅ | ❌ | ❌ | ❌ |
| View Command Center | ✅ | ❌ | ❌ | ❌ | ❌ |
| View all reports | ✅ | ✅ | area-scoped | own-area | own orders |
| Manage routes (all) | ✅ | ✅ | ❌ | ❌ | ❌ |
| Manage own route/visits | — | — | — | ✅ | — |
| View support tickets (all) | ✅ | ✅ | ❌ | ❌ | — |
| Raise own support ticket + reply | — | — | — | — | ✅ |
| Answer tickets / change status | ✅ | ✅ | ❌ | ❌ | ❌ |
| Set credit payment terms (Net-N) | ✅ | ✅ | ❌ | ❌ | ❌ |

## Notes

- **Staff** can create/edit products but not delete them — deletion is reserved for Admin/Super Admin to prevent accidental catalog loss during day-to-day operations.
- **Categories & brands** follow the same split: `master_data.manage` (create/edit/deactivate) is also held by Staff, while `master_data.delete` is Admin/Super Admin only — mirroring the RLS `brands_admin_delete` / `categories_admin_delete` policies (0005) exactly. A brand or category still linked to products cannot be deleted (FK-protected); deactivate it instead.
- **Salesman** never sees another salesman's orders or retailers outside their assigned beat — enforced via `orders.collected_by` and `retailers.assigned_salesman_id` in RLS.
- **Retailer** RLS scopes every query to `retailer_id = auth.uid()` — there is no code path, buggy or otherwise, that returns another retailer's data.
- **Admin Dashboard** (`dashboard.view`) is the operational home for Admin and Super Admin. Individual cards still hide behind existing permissions (`orders.view.all`, `inventory.view`, `retailers.manage_wallet`, `collections.verify`, `support.manage`). The Super Admin Command Center stays `command_center.view` only.
- Only **Super Admin** can create Staff or Salesman accounts (Phase 2 Admin Panel) — Admin cannot create accounts with equal or greater privilege than itself.
