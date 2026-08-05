import { Footprints } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { Card } from '@/components/ui/card';
import { Select } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { AdminEmptyState } from '@/components/admin/empty-state';

const STATUS_STYLES: Record<string, string> = {
  planned: 'bg-ink-100 text-ink-600',
  checked_in: 'bg-blue-50 text-blue-700',
  checked_out: 'bg-green-50 text-green-700',
  skipped: 'bg-primary-50 text-primary-700',
};

interface VisitRow {
  id: string;
  status: string;
  check_in_at: string | null;
  check_out_at: string | null;
  notes: string | null;
  profiles: { full_name: string } | null;
  retailers: { shop_name: string } | null;
  orders: { order_number: string } | null;
}

export default async function AdminVisitsPage({
  searchParams,
}: {
  searchParams: { status?: string; date?: string };
}) {
  const supabase = createClient();
  const status = searchParams.status ?? '';
  const date = searchParams.date || new Date().toISOString().slice(0, 10);

  let query = supabase
    .from('visits')
    .select('id, status, check_in_at, check_out_at, notes, profiles ( full_name ), retailers ( shop_name ), orders ( order_number )')
    .gte('created_at', `${date}T00:00:00`)
    .lte('created_at', `${date}T23:59:59`)
    .order('created_at', { ascending: false });

  if (status) query = query.eq('status', status);

  const { data } = await query;
  const visits = (data ?? []) as unknown as VisitRow[];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-ink-950">Visits</h1>
        <p className="mt-1 text-sm text-ink-500">Retailer visits logged by your salesmen.</p>
      </div>

      <Card>
        <form method="get" className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <input
            name="date"
            type="date"
            defaultValue={date}
            max={new Date().toISOString().slice(0, 10)}
            className="h-11 rounded-xl border border-ink-200 bg-white px-3.5 text-sm text-ink-900 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-primary-600"
          />
          <Select name="status" defaultValue={status}>
            <option value="">All statuses</option>
            <option value="planned">Planned</option>
            <option value="checked_in">Checked in</option>
            <option value="checked_out">Checked out</option>
            <option value="skipped">Skipped</option>
          </Select>
          <Button type="submit" size="sm" variant="secondary">
            Apply
          </Button>
        </form>
      </Card>

      {visits.length === 0 ? (
        <AdminEmptyState
          icon={Footprints}
          title="No visits for this date"
          body="Retailer visits your salesmen log on their routes will appear here."
        />
      ) : (
        <Card className="overflow-hidden p-0">
          <table className="w-full text-sm">
            <thead className="border-b border-ink-100 bg-ink-50 text-left text-xs uppercase tracking-wide text-ink-500">
              <tr>
                <th className="px-5 py-3 font-medium">Salesman</th>
                <th className="px-5 py-3 font-medium">Retailer</th>
                <th className="px-5 py-3 font-medium">Status</th>
                <th className="px-5 py-3 font-medium">Check-in</th>
                <th className="px-5 py-3 font-medium">Check-out</th>
                <th className="px-5 py-3 font-medium">Order</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-100">
              {visits.map((v) => (
                <tr key={v.id}>
                  <td className="px-5 py-3 font-medium text-ink-900">{v.profiles?.full_name ?? '—'}</td>
                  <td className="px-5 py-3 text-ink-600">{v.retailers?.shop_name ?? '—'}</td>
                  <td className="px-5 py-3">
                    <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${STATUS_STYLES[v.status]}`}>
                      {v.status.replace('_', ' ')}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-ink-500">{v.check_in_at ? new Date(v.check_in_at).toLocaleTimeString('en-IN') : '—'}</td>
                  <td className="px-5 py-3 text-ink-500">{v.check_out_at ? new Date(v.check_out_at).toLocaleTimeString('en-IN') : '—'}</td>
                  <td className="px-5 py-3">
                    {v.orders ? (
                      <span className="font-mono text-xs text-primary-600">{v.orders.order_number}</span>
                    ) : (
                      <span className="text-xs text-ink-300">No order</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
