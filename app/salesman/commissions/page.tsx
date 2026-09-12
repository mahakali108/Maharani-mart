import { IndianRupee } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { requireUser } from '@/lib/auth/session';
import { Card } from '@/components/ui/card';
import { AdminEmptyState } from '@/components/admin/empty-state';

interface CommissionRow {
  id: string;
  period_start: string;
  period_end: string;
  basis: string;
  rate_percent: number;
  basis_amount_paise: number;
  computed_amount_paise: number;
  status: string;
  paid_at: string | null;
}

const STATUS_STYLES: Record<string, string> = {
  draft: 'bg-amber-50 text-amber-700',
  approved: 'bg-blue-50 text-blue-700',
  paid: 'bg-emerald-50 text-emerald-700',
};

function paiseToRupees(paise: number): string {
  return `₹${(paise / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
}

export default async function SalesmanCommissionsPage() {
  const user = await requireUser();
  const supabase = createClient();

  const { data } = await supabase
    .from('staff_commissions')
    .select('id, period_start, period_end, basis, rate_percent, basis_amount_paise, computed_amount_paise, status, paid_at')
    .eq('user_id', user.id)
    .order('period_start', { ascending: false })
    .returns<CommissionRow[]>();

  const commissions = data ?? [];
  const totalPaid = commissions
    .filter((c) => c.status === 'paid')
    .reduce((sum, c) => sum + c.computed_amount_paise, 0);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-ink-950">My commissions</h1>
        <p className="mt-1 text-sm text-ink-500">Incentive records your admin generated from your real collected orders.</p>
      </div>

      {commissions.length > 0 ? (
        <Card className="flex items-center justify-between">
          <div>
            <p className="text-sm text-ink-500">Total paid out</p>
            <p className="text-xl font-semibold text-ink-950">{paiseToRupees(totalPaid)}</p>
          </div>
        </Card>
      ) : null}

      {commissions.length === 0 ? (
        <AdminEmptyState
          icon={IndianRupee}
          title="No commission records yet"
          body="When your admin generates a commission for your sales, it will appear here with its status."
        />
      ) : (
        <div className="space-y-3">
          {commissions.map((c) => (
            <Card key={c.id} className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="font-medium text-ink-900">
                  {c.basis === 'sales_value' ? 'Sales value' : 'Collection value'} · {c.rate_percent}%
                </p>
                <p className="text-xs text-ink-400">
                  {c.period_start} → {c.period_end} · basis {paiseToRupees(c.basis_amount_paise)}
                  {c.paid_at ? ' · paid' : ''}
                </p>
              </div>
              <div className="flex items-center gap-3">
                <p className="font-semibold text-ink-900">{paiseToRupees(c.computed_amount_paise)}</p>
                <span className={`rounded-full px-2 py-0.5 text-xs font-medium capitalize ${STATUS_STYLES[c.status] ?? 'bg-ink-100 text-ink-500'}`}>
                  {c.status}
                </span>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
