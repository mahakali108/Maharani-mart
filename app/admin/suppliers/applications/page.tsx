import Link from 'next/link';
import { ClipboardList } from 'lucide-react';
import { requirePagePermission } from '@/lib/admin/guard';
import { createClient } from '@/lib/supabase/server';
import {
  SUPPLIER_APPLICATION_STATUSES,
  SUPPLIER_REVIEW_PAGE_SIZE,
  parseSupplierReviewQuery,
} from '@/lib/admin/supplier-application';
import { formatIndiaDateTime } from '@/lib/datetime/india';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { AdminEmptyState } from '@/components/admin/empty-state';
import { StatusBadge } from '@/components/admin/status-badge';

export const dynamic = 'force-dynamic';

interface SupplierRow {
  id: string;
  business_name: string;
  contact_name: string;
  phone: string;
  city: string | null;
  status: string;
  created_at: string;
}

/**
 * Supplier application review queue. Authorization: `suppliers.review`
 * (Admin + Super Admin) checked server-side here, and RLS
 * (`suppliers_admin_read`, is_admin_or_above, migration 0059) as the
 * database boundary — retailers, staff and salesmen can read nothing.
 */
export default async function SupplierApplicationsPage({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  await requirePagePermission('suppliers.review');
  const query = parseSupplierReviewQuery(searchParams);
  const supabase = createClient();
  const from = (query.page - 1) * SUPPLIER_REVIEW_PAGE_SIZE;

  const { data, count, error } = await supabase
    .from('suppliers' as never)
    .select('id, business_name, contact_name, phone, city, status, created_at', { count: 'exact' })
    .eq('status', query.status)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .range(from, from + SUPPLIER_REVIEW_PAGE_SIZE - 1);
  const rows = (data ?? []) as unknown as SupplierRow[];
  const total = count ?? rows.length;
  const pages = Math.max(1, Math.ceil(total / SUPPLIER_REVIEW_PAGE_SIZE));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-semibold text-ink-950">
          <ClipboardList className="h-6 w-6" aria-hidden /> Supplier applications
        </h1>
        <p className="mt-1 max-w-2xl text-sm text-ink-500">
          Businesses that applied via the public supplier form. Approval creates the supplier record only —
          it does not create a login, grant inventory, or enable payments. GSTIN values are applicant-declared
          and are not marked verified by approval alone.
        </p>
      </div>

      <nav className="flex flex-wrap gap-2" aria-label="Filter by status">
        {SUPPLIER_APPLICATION_STATUSES.map((s) => (
          <Link key={s} href={`/admin/suppliers/applications?status=${s}`}>
            <Button size="sm" variant={query.status === s ? 'primary' : 'outline'} className="capitalize">
              {s}
            </Button>
          </Link>
        ))}
      </nav>

      {error ? (
        <Card role="alert">
          <p className="text-sm font-semibold text-ink-900">Applications could not be loaded</p>
          <p className="mt-0.5 text-sm text-ink-600">
            {error.message.includes('does not exist') || error.message.includes('relation')
              ? 'The supplier applications table is not available yet (migration 0059 has not been applied to this environment). No data was changed.'
              : 'Please retry. No data was changed.'}
          </p>
        </Card>
      ) : rows.length === 0 ? (
        <AdminEmptyState
          icon={ClipboardList}
          title={`No ${query.status} applications`}
          body="New applications submitted through the public supplier form will appear here for review."
        />
      ) : (
        <>
          <Card className="overflow-x-auto p-0">
            <table className="w-full min-w-[760px] text-sm">
              <caption className="sr-only">{query.status} supplier applications</caption>
              <thead className="border-b border-ink-100 bg-ink-50 text-left text-xs uppercase tracking-wide text-ink-500">
                <tr>
                  <th className="px-5 py-3 font-medium">Business</th>
                  <th className="px-5 py-3 font-medium">Contact</th>
                  <th className="px-5 py-3 font-medium">Phone</th>
                  <th className="px-5 py-3 font-medium">City</th>
                  <th className="px-5 py-3 font-medium">Status</th>
                  <th className="px-5 py-3 font-medium">Applied</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100">
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td className="px-5 py-3">
                      <Link
                        href={`/admin/suppliers/applications/${r.id}`}
                        className="font-medium text-ink-900 hover:text-primary-600"
                      >
                        {r.business_name}
                      </Link>
                    </td>
                    <td className="px-5 py-3 text-ink-600">{r.contact_name}</td>
                    <td className="px-5 py-3 text-ink-600">{r.phone}</td>
                    <td className="px-5 py-3 text-ink-600">{r.city ?? '—'}</td>
                    <td className="px-5 py-3">
                      <StatusBadge status={r.status} />
                    </td>
                    <td className="px-5 py-3 text-ink-500">{formatIndiaDateTime(r.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
          <nav className="flex items-center justify-between text-sm" aria-label="Application pages">
            <p className="text-ink-500">
              {total.toLocaleString('en-IN')} application(s) · Page {Math.min(query.page, pages)} of {pages}
            </p>
            <div className="flex gap-2">
              {query.page > 1 ? (
                <Link href={`/admin/suppliers/applications?status=${query.status}&page=${query.page - 1}`}>
                  <Button size="sm" variant="outline">Previous</Button>
                </Link>
              ) : null}
              {query.page < pages ? (
                <Link href={`/admin/suppliers/applications?status=${query.status}&page=${query.page + 1}`}>
                  <Button size="sm" variant="outline">Next</Button>
                </Link>
              ) : null}
            </div>
          </nav>
        </>
      )}
    </div>
  );
}
