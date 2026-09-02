import { notFound } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { resolveDocumentUrl } from '@/lib/media/document-url';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { RetailerRowActions } from '@/components/admin/retailer-row-actions';
import { RetailerAreaReassignForm } from '@/components/admin/retailer-area-reassign-form';
import { SalesmanAssignmentForm } from '@/components/admin/salesman-assignment-form';
import { RetailerDocumentsManager, type RetailerDocument } from '@/components/admin/retailer-documents-manager';

interface RetailerBaseDetail {
  id: string;
  shop_name: string;
  gstin: string | null;
  area_id: string;
  address: string | null;
  credit_limit: number;
  outstanding_balance: number;
  status: 'pending_approval' | 'active' | 'suspended';
  approved_at: string | null;
  assigned_salesman_id: string | null;
  created_at: string;
}

interface RetailerDetail extends RetailerBaseDetail {
  areas: { name: string } | null;
  profiles: { full_name: string; phone: string } | null;
}

const STATUS_STYLES: Record<RetailerDetail['status'], string> = {
  pending_approval: 'bg-amber-50 text-amber-700',
  active: 'bg-green-50 text-green-700',
  suspended: 'bg-primary-50 text-primary-700',
};

const STATUS_LABELS: Record<RetailerDetail['status'], string> = {
  pending_approval: 'Pending Approval',
  active: 'Active',
  suspended: 'Suspended',
};

export default async function RetailerDetailPage({ params }: { params: { id: string } }) {
  const supabase = createClient();

  const [{ data: retailerBase }, { data: areaData }, { data: docData }, { data: salesmanData }] = await Promise.all([
    supabase
      .from('retailers')
      .select(
        'id, shop_name, gstin, area_id, address, credit_limit, outstanding_balance, status, approved_at, assigned_salesman_id, created_at'
      )
      .eq('id', params.id)
      .single<RetailerBaseDetail>(),
    supabase.from('areas').select('id, name').eq('is_active', true).order('name'),
    supabase
      .from('retailer_documents')
      .select('id, doc_type, file_url, file_name, created_at')
      .eq('retailer_id', params.id)
      .order('created_at', { ascending: false }),
    supabase
      .from('profiles')
      .select('id, full_name, is_active')
      .eq('role', 'salesman')
      .order('full_name'),
  ]);

  if (!retailerBase) notFound();

  // Same reasoning as app/admin/retailers/page.tsx: fetched separately
  // instead of embedded, so a profile/area lookup issue can never make
  // an otherwise-real retailer 404 via .single() finding nothing.
  const [{ data: profileRow }, { data: areaRow }] = await Promise.all([
    supabase.from('profiles').select('full_name, phone').eq('id', retailerBase.id).maybeSingle<{
      full_name: string;
      phone: string;
    }>(),
    supabase.from('areas').select('name').eq('id', retailerBase.area_id).maybeSingle<{ name: string }>(),
  ]);

  const r: RetailerDetail = {
    ...retailerBase,
    profiles: profileRow ? { full_name: profileRow.full_name, phone: profileRow.phone } : null,
    areas: areaRow ? { name: areaRow.name } : null,
  };

  const documents: RetailerDocument[] = await Promise.all(
    ((docData ?? []) as { id: string; doc_type: string; file_url: string; file_name: string; created_at: string }[]).map(
      async (doc) => ({
        id: doc.id,
        doc_type: doc.doc_type,
        file_name: doc.file_name,
        created_at: doc.created_at,
        signedUrl: await resolveDocumentUrl(doc.file_url),
      })
    )
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
        <div>
          <h1 className="text-2xl font-semibold text-ink-950">{r.shop_name}</h1>
          <p className="mt-1 text-sm text-ink-500">
            {r.profiles?.full_name ?? 'Unknown owner'} {r.profiles?.phone ? `· ${r.profiles.phone}` : ''}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className={`rounded-full px-3 py-1.5 text-xs font-medium ${STATUS_STYLES[r.status]}`}>
            {STATUS_LABELS[r.status]}
          </span>
          <RetailerRowActions retailerId={r.id} status={r.status} />
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Shop details</CardTitle>
        </CardHeader>
        <dl className="grid grid-cols-1 gap-4 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-ink-400">Area</dt>
            <dd className="mt-0.5 font-medium text-ink-900">{r.areas?.name ?? '—'}</dd>
          </div>
          <div>
            <dt className="text-ink-400">GSTIN</dt>
            <dd className="mt-0.5 font-medium text-ink-900">{r.gstin ?? '—'}</dd>
          </div>
          <div className="sm:col-span-2">
            <dt className="text-ink-400">Address</dt>
            <dd className="mt-0.5 font-medium text-ink-900">{r.address ?? '—'}</dd>
          </div>
          <div>
            <dt className="text-ink-400">Credit limit</dt>
            <dd className="mt-0.5 font-medium text-ink-900">₹{r.credit_limit.toFixed(2)}</dd>
          </div>
          <div>
            <dt className="text-ink-400">Outstanding balance</dt>
            <dd className="mt-0.5 font-medium text-ink-900">₹{r.outstanding_balance.toFixed(2)}</dd>
          </div>
          <div>
            <dt className="text-ink-400">Registered</dt>
            <dd className="mt-0.5 font-medium text-ink-900">{new Date(r.created_at).toLocaleDateString('en-IN')}</dd>
          </div>
          <div>
            <dt className="text-ink-400">Approved</dt>
            <dd className="mt-0.5 font-medium text-ink-900">
              {r.approved_at ? new Date(r.approved_at).toLocaleDateString('en-IN') : 'Not yet approved'}
            </dd>
          </div>
        </dl>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Salesman assignment</CardTitle>
        </CardHeader>
        <p className="mb-3 text-sm text-ink-500">
          Currently assigned: <span className="font-medium text-ink-800">
            {((salesmanData ?? []) as { id: string; full_name: string; is_active: boolean }[]).find((salesman) => salesman.id === r.assigned_salesman_id)?.full_name ?? 'No salesman'}
          </span>
        </p>
        <SalesmanAssignmentForm
          retailerId={r.id}
          currentSalesmanId={r.assigned_salesman_id}
          salesmen={((salesmanData ?? []) as { id: string; full_name: string; is_active: boolean }[])
            .filter((salesman) => salesman.is_active || salesman.id === r.assigned_salesman_id)
            .map((salesman) => ({
              id: salesman.id,
              full_name: salesman.is_active ? salesman.full_name : `${salesman.full_name} (inactive)`,
            }))}
        />
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Reassign area</CardTitle>
        </CardHeader>
        <RetailerAreaReassignForm retailerId={r.id} currentAreaId={r.area_id} areas={areaData ?? []} />
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Documents</CardTitle>
        </CardHeader>
        <RetailerDocumentsManager retailerId={r.id} documents={documents} />
      </Card>

      {/* Order History Section */}
      <RetailerOrderHistory retailerId={r.id} />
    </div>
  );
          }

// ---------------------------------------------------------------------------
// Retailer Order History
// ---------------------------------------------------------------------------

const ORDER_STATUS_STYLES: Record<string, string> = {
  pending: 'bg-amber-50 text-amber-700',
  confirmed: 'bg-blue-50 text-blue-700',
  processing: 'bg-blue-50 text-blue-700',
  packed: 'bg-violet-50 text-violet-700',
  dispatched: 'bg-violet-50 text-violet-700',
  delivered: 'bg-green-50 text-green-700',
  cancelled: 'bg-primary-50 text-primary-700',
  returned: 'bg-primary-50 text-primary-700',
};

interface RetailerOrder {
  id: string;
  order_number: string;
  status: string;
  grand_total: number;
  placed_at: string;
}

async function RetailerOrderHistory({ retailerId }: { retailerId: string }) {
  const supabase = createClient();

  const [{ data: orderData }, { data: statsData }] = await Promise.all([
    supabase
      .from('orders')
      .select('id, order_number, status, grand_total, placed_at')
      .eq('retailer_id', retailerId)
      .order('placed_at', { ascending: false })
      .limit(15),
    supabase
      .from('orders')
      .select('grand_total, status')
      .eq('retailer_id', retailerId)
      .neq('status', 'cancelled'),
  ]);

  const orders = (orderData ?? []) as RetailerOrder[];
  const allOrders = (statsData ?? []) as { grand_total: number; status: string }[];
  const totalSpent = allOrders.reduce((sum, o) => sum + o.grand_total, 0);
  const totalOrders = allOrders.length;
  const avgOrder = totalOrders > 0 ? totalSpent / totalOrders : 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Order History</CardTitle>
      </CardHeader>

      {totalOrders > 0 ? (
        <div className="mb-4 grid grid-cols-3 gap-3">
          <div className="rounded-xl bg-ink-50 p-3">
            <p className="text-xs text-ink-500">Total Orders</p>
            <p className="mt-1 text-lg font-semibold text-ink-950">{totalOrders}</p>
          </div>
          <div className="rounded-xl bg-ink-50 p-3">
            <p className="text-xs text-ink-500">Total Purchased</p>
            <p className="mt-1 text-lg font-semibold text-ink-950">₹{totalSpent.toFixed(2)}</p>
          </div>
          <div className="rounded-xl bg-ink-50 p-3">
            <p className="text-xs text-ink-500">Avg. Order</p>
            <p className="mt-1 text-lg font-semibold text-ink-950">₹{avgOrder.toFixed(2)}</p>
          </div>
        </div>
      ) : null}

      {orders.length === 0 ? (
        <p className="text-sm text-ink-500">This retailer has not placed any orders yet.</p>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-ink-100 bg-ink-50 text-left text-xs uppercase tracking-wide text-ink-500">
                <tr>
                  <th className="px-5 py-2 font-medium">Order</th>
                  <th className="px-5 py-2 font-medium">Date</th>
                  <th className="px-5 py-2 font-medium">Status</th>
                  <th className="px-5 py-2 font-medium">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100">
                {orders.map((o) => (
                  <tr key={o.id}>
                    <td className="px-5 py-2">
                      <Link href={`/admin/orders/${o.id}`} className="font-mono text-xs font-medium text-primary-600 hover:text-primary-700">
                        {o.order_number}
                      </Link>
                    </td>
                    <td className="px-5 py-2 text-xs text-ink-400">{new Date(o.placed_at).toLocaleDateString('en-IN')}</td>
                    <td className="px-5 py-2">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${ORDER_STATUS_STYLES[o.status] ?? 'bg-ink-100 text-ink-600'}`}>
                        {o.status.charAt(0).toUpperCase() + o.status.slice(1)}
                      </span>
                    </td>
                    <td className="px-5 py-2 font-medium text-ink-900">₹{o.grand_total.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-3 text-right">
            <Link href={`/admin/orders?retailer=${retailerId}`} className="text-xs font-medium text-primary-600 hover:text-primary-700">
              View all orders →
            </Link>
          </div>
        </>
      )}
    </Card>
  );
}
