import { serviceAreaLabel } from '@/lib/areas/district';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { throwIfReadFailed } from '@/lib/supabase/read-guard';
import { resolveDocumentUrl } from '@/lib/media/document-url';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { RetailerRowActions } from '@/components/admin/retailer-row-actions';
import { RetailerActivationPanel } from '@/components/admin/retailer-activation-panel';
import { getRetailerActivationStatus } from '@/lib/admin/retailer-activation-actions';
import { requireUser } from '@/lib/auth/session';
import { RetailerAreaReassignForm } from '@/components/admin/retailer-area-reassign-form';
import { SalesmanAssignmentForm } from '@/components/admin/salesman-assignment-form';
import { RetailerDocumentsManager, type RetailerDocument } from '@/components/admin/retailer-documents-manager';
import { formatIndiaDate, formatIndiaDateTime } from '@/lib/datetime/india';

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
  areas: { name: string; district: string } | null;
  profiles: { full_name: string; phone: string } | null;
}

const STATUS_STYLES: Record<RetailerDetail['status'], string> = {
  pending_approval: 'bg-amber-50 text-amber-700',
  active: 'bg-mint-50 text-mint-700',
  suspended: 'bg-primary-50 text-primary-700',
};

const STATUS_LABELS: Record<RetailerDetail['status'], string> = {
  pending_approval: 'Pending Approval',
  active: 'Active',
  suspended: 'Suspended',
};

export default async function RetailerDetailPage({ params: paramsPromise }: { params: Promise<{ id: string }> }) {
  const params = await paramsPromise;
  const supabase = (await createClient());

  const [{ data: retailerBase, error: retailerError }, { data: areaData }, { data: docData }, { data: salesmanData }] = await Promise.all([
    supabase
      .from('retailers')
      .select(
        'id, shop_name, gstin, area_id, address, credit_limit, outstanding_balance, status, approved_at, assigned_salesman_id, created_at'
      )
      .eq('id', params.id)
      .single<RetailerBaseDetail>(),
    supabase.from('areas').select('id, name, district, is_active').order('name'),
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

  // A failed read must not be rendered as "retailer not found".
  throwIfReadFailed(retailerError, 'Retailer');
  if (!retailerBase) notFound();

  // Same reasoning as app/admin/retailers/page.tsx: fetched separately
  // instead of embedded, so a profile/area lookup issue can never make
  // an otherwise-real retailer 404 via .single() finding nothing.
  const [{ data: profileRow }, { data: areaRow }] = await Promise.all([
    supabase.from('profiles').select('full_name, phone').eq('id', retailerBase.id).maybeSingle<{
      full_name: string;
      phone: string;
    }>(),
    supabase.from('areas').select('name, district').eq('id', retailerBase.area_id).maybeSingle<{ name: string; district: string }>(),
  ]);

  const r: RetailerDetail = {
    ...retailerBase,
    profiles: profileRow ? { full_name: profileRow.full_name, phone: profileRow.phone } : null,
    areas: areaRow,
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

  // Activation state is read for every viewer, but the RPC itself is
  // service-role-only and the helper returns null for anyone below Super Admin.
  const [viewer, activationStatus] = await Promise.all([
    requireUser(),
    getRetailerActivationStatus(params.id),
  ]);
  const isSuperAdmin = viewer.role === 'super_admin';

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
          <CardTitle>Sign-in and activation</CardTitle>
        </CardHeader>
        <p className="mb-4 text-sm text-ink-500">
          Approving an application grants the retailer role and access status. It does not
          automatically restore sign-in for an account that is inactive — that is this step.
        </p>
        <RetailerActivationPanel
          retailerId={r.id}
          isSuperAdmin={isSuperAdmin}
          state={activationStatus}
        />
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Shop details</CardTitle>
        </CardHeader>
        <dl className="grid grid-cols-1 gap-4 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-ink-400">Area</dt>
            <dd className="mt-0.5 font-medium text-ink-900">{r.areas ? serviceAreaLabel(r.areas) : '—'}</dd>
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
            <dt className="text-ink-400">Coin funding (legacy credit limit)</dt>
            <dd className="mt-0.5 font-medium text-ink-900">₹{r.credit_limit.toFixed(2)}</dd>
          </div>
          <div>
            <dt className="text-ink-400">🪙 Coins spent (legacy outstanding)</dt>
            <dd className="mt-0.5 font-medium text-ink-900">₹{r.outstanding_balance.toFixed(2)}</dd>
          </div>
          <div>
            <dt className="text-ink-400">Registered</dt>
            <dd className="mt-0.5 font-medium text-ink-900">{formatIndiaDate(r.created_at)}</dd>
          </div>
          <div>
            <dt className="text-ink-400">Approved</dt>
            <dd className="mt-0.5 font-medium text-ink-900">
              {r.approved_at ? formatIndiaDate(r.approved_at) : 'Not yet approved'}
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
          <CardTitle>Service district &amp; area</CardTitle>
        </CardHeader>
        <p className="mb-4 text-sm text-ink-500">Changing the service area also changes its district and may affect area pricing. Delivery addresses and historical orders are not rewritten.</p>
        <RetailerAreaReassignForm key={`${r.id}:${r.area_id}`} retailerId={r.id} currentAreaId={r.area_id} areas={(areaData ?? []).filter((area: { id: string; is_active: boolean }) => area.is_active || area.id === r.area_id)} />
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
  confirmed: 'bg-sky-50 text-sky-700',
  processing: 'bg-sky-50 text-sky-700',
  packed: 'bg-violet-50 text-violet-700',
  dispatched: 'bg-violet-50 text-violet-700',
  delivered: 'bg-mint-50 text-mint-700',
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
  const supabase = (await createClient());

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
        <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
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
          <div className="table-scroll overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
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
                    <td className="px-5 py-2 text-xs text-ink-400">{formatIndiaDateTime(o.placed_at)}</td>
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
