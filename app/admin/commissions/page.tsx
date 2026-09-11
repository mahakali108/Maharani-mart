import { IndianRupee } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { requirePermission } from '@/lib/admin/guard';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { AdminEmptyState } from '@/components/admin/empty-state';
import { CommissionForm } from '@/components/admin/commission-form';
import { CommissionRowActions } from '@/components/admin/commission-row-actions';

interface MemberRow {
  id: string;
  full_name: string;
  role: string;
}

interface CommissionRow {
  id: string;
  user_id: string;
  period_start: string;
  period_end: string;
  basis: string;
  rate_percent: number;
  basis_amount_paise: number;
  computed_amount_paise: number;
  status: string;
  notes: string | null;
}

const STATUS_STYLES: Record<string, string> = {
  draft: 'bg-amber-50 text-amber-700',
  approved: 'bg-blue-50 text-blue-700',
  paid: 'bg-emerald-50 text-emerald-700',
};

function paiseToRupees(paise: number): string {
  return `₹${(paise / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
}

export default async function AdminCommissionsPage() {
  await requirePermission('commissions.manage');
  const supabase = createClient();

  const [{ data: memberData }, { data: commissionData }] = await Promise.all([
    supabase
      .from('profiles')
      .select('id, full_name, role')
      .in('role', ['staff', 'salesman'])
      .eq('is_active', true)
      .order('full_name')
      .returns<MemberRow[]>(),
    supabase
      .from('staff_commissions')
      .select('id, user_id, period_start, period_end, basis, rate_percent, basis_amount_paise, computed_amount_paise, status, notes')
      .order('period_start', { ascending: false })
      .returns<CommissionRow[]>(),
  ]);

  const members = memberData ?? [];
  const memberById = new Map(members.map((m) => [m.id, m]));
  const commissions = commissionData ?? [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-ink-950">Commissions</h1>
        <p className="mt-1 text-sm text-ink-500">
          Incentive records computed from real collected orders. Lifecycle: draft → approved → paid; nothing is deleted.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Generate a commission</CardTitle>
        </CardHeader>
        {members.length === 0 ? (
          <AdminEmptyState
            icon={IndianRupee}
            title="No team members yet"
            body="Create a staff or sales executive account first — commissions are generated per member."
          />
        ) : (
          <CommissionForm members={members} />
        )}
      </Card>

      {commissions.length === 0 ? (
        <AdminEmptyState
          icon={IndianRupee}
          title="No commission records yet"
          body="Generate a record above — the basis amount is always computed from the member's real orders in the period."
        />
      ) : (
        <Card className="table-scroll p-0">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="border-b border-ink-100 bg-ink-50 text-left text-xs uppercase tracking-wide text-ink-500">
              <tr>
                <th className="px-5 py-3 font-medium">Member</th>
                <th className="px-5 py-3 font-medium">Period</th>
                <th className="px-5 py-3 font-medium">Basis</th>
                <th className="px-5 py-3 font-medium">Basis amount</th>
                <th className="px-5 py-3 font-medium">Rate</th>
                <th className="px-5 py-3 font-medium">Commission</th>
                <th className="px-5 py-3 font-medium">Status</th>
                <th className="px-5 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-100">
              {commissions.map((c) => (
                <tr key={c.id}>
                  <td className="px-5 py-3 font-medium text-ink-900">{memberById.get(c.user_id)?.full_name ?? 'Unknown member'}</td>
                  <td className="px-5 py-3 text-ink-600">
                    {c.period_start} → {c.period_end}
                  </td>
                  <td className="px-5 py-3 text-ink-600">{c.basis === 'sales_value' ? 'Sales value' : 'Collection value'}</td>
                  <td className="px-5 py-3 text-ink-600">{paiseToRupees(c.basis_amount_paise)}</td>
                  <td className="px-5 py-3 text-ink-600">{c.rate_percent}%</td>
                  <td className="px-5 py-3 font-semibold text-ink-900">{paiseToRupees(c.computed_amount_paise)}</td>
                  <td className="px-5 py-3">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium capitalize ${STATUS_STYLES[c.status] ?? 'bg-ink-100 text-ink-500'}`}>
                      {c.status}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-right">
                    <CommissionRowActions commissionId={c.id} status={c.status} />
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
