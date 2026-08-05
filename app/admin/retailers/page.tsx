import Link from 'next/link';
import { Users, Search } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { AdminEmptyState } from '@/components/admin/empty-state';
import { RetailerRowActions } from '@/components/admin/retailer-row-actions';

interface RetailerRow {
  id: string;
  shop_name: string;
  address: string | null;
  status: 'pending_approval' | 'active' | 'suspended';
  created_at: string;
  areas: { name: string } | null;
  profiles: { full_name: string; phone: string } | null;
}

const STATUS_STYLES: Record<RetailerRow['status'], string> = {
  pending_approval: 'bg-amber-50 text-amber-700',
  active: 'bg-green-50 text-green-700',
  suspended: 'bg-primary-50 text-primary-700',
};

const STATUS_LABELS: Record<RetailerRow['status'], string> = {
  pending_approval: 'Pending Approval',
  active: 'Active',
  suspended: 'Suspended',
};

export default async function RetailersPage({ searchParams }: { searchParams: { q?: string } }) {
  const supabase = createClient();
  const q = searchParams.q?.trim().toLowerCase() ?? '';

  const { data } = await supabase
    .from('retailers')
    .select('id, shop_name, address, status, created_at, areas ( name ), profiles ( full_name, phone )')
    .order('created_at', { ascending: false });

  let retailers = (data ?? []) as unknown as RetailerRow[];
  if (q) {
    retailers = retailers.filter(
      (r) =>
        r.shop_name.toLowerCase().includes(q) ||
        r.profiles?.full_name.toLowerCase().includes(q) ||
        r.profiles?.phone.includes(q)
    );
  }
  const pending = retailers.filter((r) => r.status === 'pending_approval');
  const others = retailers.filter((r) => r.status !== 'pending_approval');

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-ink-950">Retailers</h1>
        <p className="mt-1 text-sm text-ink-500">
          New retailer registrations must be approved here before they can place orders.
        </p>
      </div>

      <form method="get" className="flex gap-2">
        <div className="relative flex-1 sm:max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
          <Input name="q" defaultValue={q} placeholder="Search shop, owner, or phone…" className="pl-9" />
        </div>
        <Button type="submit" variant="outline" size="sm">
          Search
        </Button>
      </form>

      {retailers.length === 0 ? (
        <AdminEmptyState
          icon={Users}
          title={q ? 'No retailers match your search' : 'No retailer registrations yet'}
          body={
            q
              ? 'Try a different name or phone number, or clear the search box above.'
              : "Once retailers sign up at /register-retailer, they'll appear here awaiting your approval."
          }
        />
      ) : (
        <>
          {pending.length > 0 ? (
            <div>
              <h2 className="mb-3 text-sm font-semibold text-ink-800">
                Pending Approval <span className="text-primary-600">({pending.length})</span>
              </h2>
              <RetailerTable retailers={pending} />
            </div>
          ) : null}

          {others.length > 0 ? (
            <div>
              <h2 className="mb-3 mt-8 text-sm font-semibold text-ink-800">All Retailers</h2>
              <RetailerTable retailers={others} />
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}

function RetailerTable({ retailers }: { retailers: RetailerRow[] }) {
  return (
    <Card className="overflow-hidden p-0">
      <table className="w-full text-sm">
        <thead className="border-b border-ink-100 bg-ink-50 text-left text-xs uppercase tracking-wide text-ink-500">
          <tr>
            <th className="px-5 py-3 font-medium">Shop</th>
            <th className="px-5 py-3 font-medium">Owner</th>
            <th className="px-5 py-3 font-medium">Area</th>
            <th className="px-5 py-3 font-medium">Status</th>
            <th className="px-5 py-3 font-medium" />
          </tr>
        </thead>
        <tbody className="divide-y divide-ink-100">
          {retailers.map((r) => (
            <tr key={r.id}>
              <td className="px-5 py-3">
                <Link href={`/admin/retailers/${r.id}`} className="font-medium text-ink-900 hover:text-primary-600">
                  {r.shop_name}
                </Link>
                {r.address ? <p className="text-xs text-ink-400">{r.address}</p> : null}
              </td>
              <td className="px-5 py-3 text-ink-600">
                {r.profiles?.full_name ?? '—'}
                {r.profiles?.phone ? <p className="text-xs text-ink-400">{r.profiles.phone}</p> : null}
              </td>
              <td className="px-5 py-3 text-ink-600">{r.areas?.name ?? '—'}</td>
              <td className="px-5 py-3">
                <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${STATUS_STYLES[r.status]}`}>
                  {STATUS_LABELS[r.status]}
                </span>
              </td>
              <td className="px-5 py-3 text-right">
                <RetailerRowActions retailerId={r.id} status={r.status} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
              }
