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
| Manage pricing & schemes | ✅ | ✅ | ❌ | ❌ | ❌ |
| View inventory | ✅ | ✅ | ✅ | ❌ | ❌ |
| Manage inventory (stock movements) | ✅ | ✅ | ✅ | ❌ | ❌ |
| View all orders | ✅ | ✅ | ✅ | ❌ | ❌ |
| View own orders | — | — | — | ✅ | ✅ |
| Create orders (on behalf of retailer) | ✅ | ✅ | ✅ | ✅ | — |
| Place own orders | ❌ | ❌ | ❌ | ❌ | ✅ |
| Approve / process orders | ✅ | ✅ | ✅ | ❌ | ❌ |
| View retailers | ✅ | ✅ | ✅ | ✅ (own) | — |
| Approve retailer registration | ✅ | ✅ | ❌ | ❌ | ❌ |
| Suspend retailer | ✅ | ✅ | ❌ | ❌ | ❌ |
| Manage staff / salesman accounts | ✅ | ❌ | ❌ | ❌ | ❌ |
| Manage banners | ✅ | ✅ | ✅ | ❌ | ❌ |
| View all reports | ✅ | ✅ | area-scoped | own-area | own orders |
| Manage routes (all) | ✅ | ✅ | ❌ | ❌ | ❌ |
| Manage own route/visits | — | — | — | ✅ | — |

## Notes

- **Staff** can create/edit products but not delete them — deletion is reserved for Admin/Super Admin to prevent accidental catalog loss during day-to-day operations.
- **Salesman** never sees another salesman's orders or retailers outside their assigned beat — enforced via `orders.collected_by` and `retailers.assigned_salesman_id` in RLS.
- **Retailer** RLS scopes every query to `retailer_id = auth.uid()` — there is no code path, buggy or otherwise, that returns another retailer's data.
- Only **Super Admin** can create Staff or Salesman accounts (Phase 2 Admin Panel) — Admin cannot create accounts with equal or greater privilege than itself.
