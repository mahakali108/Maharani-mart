import Link from 'next/link';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { requireUser } from '@/lib/auth/session';
import { formatIndiaDateTime } from '@/lib/datetime/india';
import {
  AccountRequestsCard,
  ChangePasswordForm,
  LogoutAllSessionsButton,
} from '@/components/retailer/security-forms';

interface RequestRow {
  id: string;
  request_type: 'account_deletion' | 'data_export';
  status: 'submitted' | 'reviewing' | 'completed' | 'rejected';
  created_at: string;
}

export const metadata = { title: 'Security — Maharani Traders' };

const REQUEST_STATUS_LABEL: Record<RequestRow['status'], string> = {
  submitted: 'Submitted',
  reviewing: 'Under review',
  completed: 'Completed',
  rejected: 'Not approved',
};

export default async function SecurityPage() {
  const user = await requireUser();
  const supabase = createClient();

  const { data: requestRows } = await supabase
    .from('retailer_account_requests')
    .select('id, request_type, status, created_at')
    .eq('retailer_id', user.id)
    .order('created_at', { ascending: false })
    .limit(5);
  const requests = ((requestRows ?? []) as unknown as RequestRow[]).filter(Boolean);
  const hasDeletionRequest = requests.some((row) => row.request_type === 'account_deletion' && row.status !== 'completed' && row.status !== 'rejected');

  return (
    <div className="mx-auto w-full max-w-2xl space-y-5">
      <nav aria-label="Breadcrumb" className="flex items-center gap-1 text-[10px] font-semibold text-slate-500 sm:text-xs">
        <Link href="/retailer/account" className="flex items-center gap-1 rounded px-1 py-0.5 hover:text-primary-600">
          <ChevronLeft className="h-3.5 w-3.5" /> Account
        </Link>
        <ChevronRight className="h-3 w-3" />
        <span className="truncate text-slate-800">Security</span>
      </nav>

      <div>
        <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-primary-600">Account security</p>
        <h1 className="mt-1 text-xl font-bold tracking-tight text-slate-950 sm:text-2xl">Password &amp; sessions</h1>
        <p className="mt-1 text-xs text-slate-500">Signed in as {user.email ?? 'your account'}.</p>
      </div>

      <ChangePasswordForm />
      <LogoutAllSessionsButton />
      <AccountRequestsCard hasDeletionRequest={hasDeletionRequest} />

      {requests.length > 0 ? (
        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-100 bg-slate-50 px-4 py-3.5">
            <h2 className="text-sm font-bold text-slate-900">Your past requests</h2>
          </div>
          <ul className="divide-y divide-slate-100">
            {requests.map((row) => (
              <li key={row.id} className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="truncate text-xs font-bold text-slate-900">
                    {row.request_type === 'account_deletion' ? 'Account deletion' : 'Data export'}
                  </p>
                  <p className="mt-0.5 text-[10px] text-slate-500">{formatIndiaDateTime(row.created_at)}</p>
                </div>
                <span
                  className={
                    row.status === 'completed'
                      ? 'shrink-0 rounded-full bg-emerald-50 px-2.5 py-1 text-[10px] font-bold text-emerald-700'
                      : row.status === 'rejected'
                        ? 'shrink-0 rounded-full bg-rose-50 px-2.5 py-1 text-[10px] font-bold text-rose-700'
                        : 'shrink-0 rounded-full bg-amber-50 px-2.5 py-1 text-[10px] font-bold text-amber-700'
                  }
                >
                  {REQUEST_STATUS_LABEL[row.status]}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
