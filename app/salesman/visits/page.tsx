import { Users } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { requireUser } from '@/lib/auth/session';
import { Card } from '@/components/ui/card';

const STATUS_STYLES: Record<string, string> = {
  planned: 'bg-ink-100 text-ink-600',
  checked_in: 'bg-blue-50 text-blue-700',
  checked_out: 'bg-green-50 text-green-700',
  skipped: 'bg-amber-50 text-amber-700',
};

interface VisitRow {
  id: string;
  status: string;
  check_in_at: string | null;
  check_out_at: string | null;
  notes: string | null;
  created_at: string;
  retailers: { shop_name: string; address: string | null } | null;
}

const PAGE_SIZE = 20;

export default async function SalesmanVisitsPage({
  searchParams,
}: {
  searchParams: { page?: string };
}) {
  const user = await requireUser();
  const supabase = createClient();

  const page = Math.max(1, Number(searchParams.page) || 1);
  const from = (page - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  const { data, count } = await supabase
    .from('visits')
    .select('id, status, check_in_at, check_out_at, notes, created_at, retailers ( shop_name, address )', {
      count: 'exact',
    })
    .eq('salesman_id', user.id)
    .order('created_at', { ascending: false })
    .range(from, to);

  const visits = (data ?? []) as unknown as VisitRow[];
  const totalPages = Math.max(1, Math.ceil((count ?? 0) / PAGE_SIZE));

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold text-ink-950">Visit History</h1>
        <p className="mt-1 text-sm text-ink-500">Every retailer visit you&apos;ve logged, most recent first.</p>
      </div>

      {visits.length === 0 ? (
        <Card className="flex flex-col items-center gap-2 py-12 text-center">
          <Users className="h-8 w-8 text-ink-300" />
          <p className="font-medium text-ink-700">No visits logged yet</p>
          <p className="text-sm text-ink-400">Check in to a retailer from your Routes tab to log your first visit.</p>
        </Card>
      ) : (
        <>
          <div className="space-y-2">
            {visits.map((v) => (
              <Card key={v.id} className="p-4">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="font-medium text-ink-900">{v.retailers?.shop_name ?? 'Unknown retailer'}</p>
                    {v.retailers?.address ? <p className="text-xs text-ink-400">{v.retailers.address}</p> : null}
                  </div>
                  <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${STATUS_STYLES[v.status]}`}>
                    {v.status.replace('_', ' ')}
                  </span>
                </div>
                <div className="mt-2 flex gap-4 text-xs text-ink-400">
                  {v.check_in_at ? <span>In: {new Date(v.check_in_at).toLocaleString('en-IN')}</span> : null}
                  {v.check_out_at ? <span>Out: {new Date(v.check_out_at).toLocaleString('en-IN')}</span> : null}
                </div>
                {v.notes ? <p className="mt-2 text-sm text-ink-600">{v.notes}</p> : null}
              </Card>
            ))}
          </div>

          {totalPages > 1 ? (
            <div className="flex items-center justify-center gap-2 pt-2 text-xs text-ink-400">
              Page {page} of {totalPages}
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
