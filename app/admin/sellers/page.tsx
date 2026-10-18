import Link from 'next/link';
import { Store, Users } from 'lucide-react';
import { requirePagePermission } from '@/lib/admin/guard';
import {
  SELLERS_PER_PAGE,
  listSellers,
  parseSellerListParams,
  sellerListHref,
} from '@/lib/admin/sellers-query';
import { formatIndiaDateTime } from '@/lib/datetime/india';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { AdminEmptyState } from '@/components/admin/empty-state';
import { StatusBadge } from '@/components/admin/status-badge';
import { CreateSellerForm } from '@/components/admin/create-seller-form';

export const dynamic = 'force-dynamic';

/**
 * Marketplace seller directory (/admin/sellers).
 *
 * Authorization: middleware admits admin/super_admin to /admin/*, this page
 * additionally requires `sellers.view` server-side (requirePagePermission →
 * /unauthorized), and all reads run on the caller's RLS-scoped client (0062
 * gives sellers ONLY their own rows). Distinct from Supplier Registration V1
 * (/admin/suppliers/applications) — suppliers are upstream vendors.
 */
export default async function SellersPage({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const viewer = await requirePagePermission('sellers.view');
  const query = parseSellerListParams(searchParams);
  const { sellers, total } = await listSellers(query);
  const pages = Math.max(1, Math.ceil(total / SELLERS_PER_PAGE));
  const currentPage = Math.min(query.page, pages);

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold text-ink-900">
            <Store className="h-6 w-6 text-primary-600" aria-hidden /> Marketplace sellers
          </h1>
          <p className="mt-1 text-sm text-ink-500">
            Seller businesses that own marketplace offers and sub-orders. Distinct from upstream suppliers.
          </p>
        </div>
      </header>

      {viewer.role === 'super_admin' ? (
        <Card className="p-5">
          <h2 className="text-sm font-semibold text-ink-800">Invite a seller</h2>
          <p className="mb-3 mt-1 text-xs text-ink-500">
            Only Super Admin can send an email invitation. Accounts start <strong>pending</strong> and cannot trade until approved.
          </p>
          <CreateSellerForm />
        </Card>
      ) : null}

      <form className="flex flex-wrap items-end gap-3" method="get">
        <Input
          name="q"
          placeholder="Search business, contact, phone…"
          defaultValue={query.q}
          className="max-w-xs"
        />
        <Select name="status" defaultValue={query.status} className="max-w-[12rem]">
          <option value="all">All statuses</option>
          <option value="pending">Pending</option>
          <option value="active">Active</option>
          <option value="rejected">Rejected</option>
          <option value="suspended">Suspended</option>
        </Select>
        <Button type="submit" variant="outline" size="sm">
          Search
        </Button>
        {query.q || query.status !== 'all' ? (
          <Link
            href="/admin/sellers"
            className="inline-flex h-9 items-center justify-center rounded-lg px-3 text-sm font-medium text-ink-700 transition-colors hover:bg-ink-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-600 focus-visible:ring-offset-2"
          >
            Clear
          </Link>
        ) : null}
      </form>

      {sellers.length === 0 ? (
        <AdminEmptyState
          icon={Users}
          title="No sellers yet"
          body="Create the first marketplace seller above. Sellers stay invisible to trading until an admin approves them."
        />
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-ink/10 bg-white">
          <table className="min-w-full text-left text-sm">
            <thead className="border-b border-ink/10 text-xs uppercase text-ink-500">
              <tr>
                <th className="px-4 py-3">Business</th>
                <th className="px-4 py-3">Contact</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Created</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {sellers.map((seller) => (
                <tr key={seller.id} className="border-b border-ink/5 last:border-0">
                  <td className="px-4 py-3 font-medium text-ink-900">
                    <Link href={`/admin/sellers/${seller.id}`} className="hover:underline">
                      {seller.business_name}
                    </Link>
                    {seller.gstin ? (
                      <div className="text-xs text-ink-500">GSTIN {seller.gstin}</div>
                    ) : null}
                  </td>
                  <td className="px-4 py-3 text-ink-600">
                    {seller.contact_name || seller.phone || seller.email || '—'}
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={seller.status} />
                  </td>
                  <td className="px-4 py-3 text-ink-500">{formatIndiaDateTime(seller.created_at)}</td>
                  <td className="px-4 py-3">
                    <Link href={`/admin/sellers/${seller.id}`}>
                      <Button size="sm" variant="outline">
                        Review
                      </Button>
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {pages > 1 ? (
        <nav className="flex items-center gap-2 text-sm" aria-label="Pagination">
          {Array.from({ length: pages }, (_, i) => i + 1).map((page) => (
            <Link
              key={page}
              href={sellerListHref(query, page)}
              className={
                page === currentPage
                  ? 'rounded-lg bg-primary-600 px-3 py-1 text-white'
                  : 'rounded-lg border border-ink/10 px-3 py-1 text-ink-600'
              }
            >
              {page}
            </Link>
          ))}
        </nav>
      ) : null}
    </div>
  );
}
