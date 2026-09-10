import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { rupeesToPaise, paiseToRupees } from '@/lib/retailer/wallet';
import { computeAvailablePaise, computeOutstandingPaise } from '@/lib/retailer/wallet-math';

interface RetailerRow {
  id: string;
  shop_name: string;
  status: string;
  credit_limit: number;
  outstanding_balance: number;
  created_at: string;
  profiles: { full_name: string; phone: string } | null;
}

interface CreditAccountRow {
  retailer_id: string;
  credit_limit_paise: number;
  opening_outstanding_paise: number;
  allow_overdue: boolean;
}

export default async function AdminWalletsPage({
  searchParams,
}: {
  searchParams: { q?: string };
}) {
  const supabase = createClient();
  const q = (searchParams.q ?? '').trim();

  let query = supabase
    .from('retailers')
    .select('id, shop_name, status, credit_limit, outstanding_balance, created_at')
    .order('created_at', { ascending: false })
    .limit(100);

  if (q) {
    query = query.ilike('shop_name', `%${q}%`);
  }

  const [{ data: retailers }, { data: creditAccounts }] = await Promise.all([
    query.returns<RetailerRow[]>(),
    supabase
      .from('retailer_credit_accounts')
      .select('retailer_id, credit_limit_paise, opening_outstanding_paise, allow_overdue')
      .returns<CreditAccountRow[]>(),
  ]);

  // Fetch profiles separately to avoid join issues
  const retailerIds = (retailers ?? []).map((r) => r.id);
  const { data: profileData } =
    retailerIds.length > 0
      ? await supabase
          .from('profiles')
          .select('id, full_name, phone')
          .in('id', retailerIds)
          .returns<{ id: string; full_name: string; phone: string }[]>()
      : { data: [] as { id: string; full_name: string; phone: string }[] };

  const profileById = new Map((profileData ?? []).map((p) => [p.id, p]));
  const accountByRetailer = new Map((creditAccounts ?? []).map((a) => [a.retailer_id, a]));

  // Calculate outstanding from ledger for each retailer (using DB function per retailer would be N+1, so we aggregate)
  const ledgerByRetailer = new Map<string, { debit: number; credit: number }>();
  if (retailerIds.length > 0) {
    const { data: ledgerRows } = await supabase
      .from('retailer_wallet_ledger')
      .select('retailer_id, amount_paise, direction, transaction_type, is_reversed')
      .in('retailer_id', retailerIds)
      .eq('is_reversed', false)
      .neq('transaction_type', 'CREDIT_LIMIT_CHANGE')
      .returns<
        { retailer_id: string; amount_paise: number; direction: string; transaction_type: string; is_reversed: boolean }[]
      >();
    for (const row of ledgerRows ?? []) {
      const agg = ledgerByRetailer.get(row.retailer_id) ?? { debit: 0, credit: 0 };
      if (row.direction === 'debit') agg.debit += Number(row.amount_paise);
      else agg.credit += Number(row.amount_paise);
      ledgerByRetailer.set(row.retailer_id, agg);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-ink-950">Customer Wallets / Credit Accounts</h1>
        <p className="mt-1 text-sm text-ink-500">
          B2B credit ledger — credit limit, outstanding, available, payment history, adjustments, audit.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Search retailers</CardTitle>
        </CardHeader>
        <form className="flex gap-2">
          <Input name="q" defaultValue={q} placeholder="Search by shop name..." className="max-w-sm" />
          <button type="submit" className="rounded-lg bg-ink-900 px-4 py-2 text-sm font-medium text-white">
            Search
          </button>
          {q ? (
            <Link href="/admin/wallets" className="rounded-lg border border-ink-200 px-4 py-2 text-sm">
              Clear
            </Link>
          ) : null}
        </form>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Retailers ({retailers?.length ?? 0})</CardTitle>
        </CardHeader>
        <div className="table-scroll overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="border-b border-ink-100 bg-ink-50 text-left text-xs uppercase tracking-wide text-ink-500">
              <tr>
                <th className="px-5 py-2 font-medium">Shop</th>
                <th className="px-5 py-2 font-medium">Owner</th>
                <th className="px-5 py-2 font-medium">Status</th>
                <th className="px-5 py-2 font-medium">Credit Limit</th>
                <th className="px-5 py-2 font-medium">Outstanding</th>
                <th className="px-5 py-2 font-medium">Available</th>
                <th className="px-5 py-2 font-medium">Overdue Allowed</th>
                <th className="px-5 py-2 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-100">
              {(retailers ?? []).map((r) => {
                const profile = profileById.get(r.id);
                const account = accountByRetailer.get(r.id);
                const limitPaise = account?.credit_limit_paise ?? rupeesToPaise(r.credit_limit);
                const ledgerAgg = ledgerByRetailer.get(r.id) ?? { debit: 0, credit: 0 };
                // Authoritative: outstanding = frozen opening baseline + ledger
                // delta. The legacy mirror column is only used as the opening
                // fallback when the credit account row hasn't been created yet
                // (a brand-new retailer with no ledger entries).
                const openingPaise = account?.opening_outstanding_paise ?? rupeesToPaise(r.outstanding_balance);
                const outstandingPaise = computeOutstandingPaise(openingPaise, ledgerAgg.debit, ledgerAgg.credit);
                const availablePaise = computeAvailablePaise(limitPaise, outstandingPaise);
                const limitRupees = paiseToRupees(limitPaise);
                const outstandingRupees = paiseToRupees(outstandingPaise);
                const availableRupees = paiseToRupees(availablePaise);

                return (
                  <tr key={r.id} className="hover:bg-ink-50/50">
                    <td className="px-5 py-3">
                      <Link href={`/admin/wallets/${r.id}`} className="font-medium text-primary-600 hover:text-primary-700">
                        {r.shop_name}
                      </Link>
                      <p className="text-xs text-ink-400">{r.id.slice(0, 8)}…</p>
                    </td>
                    <td className="px-5 py-3">
                      <p className="font-medium text-ink-900">{profile?.full_name ?? '—'}</p>
                      <p className="text-xs text-ink-500">{profile?.phone ?? ''}</p>
                    </td>
                    <td className="px-5 py-3">
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs ${
                          r.status === 'active'
                            ? 'bg-green-50 text-green-700'
                            : r.status === 'pending_approval'
                              ? 'bg-amber-50 text-amber-700'
                              : 'bg-primary-50 text-primary-700'
                        }`}
                      >
                        {r.status}
                      </span>
                    </td>
                    <td className="px-5 py-3 font-medium">₹{limitRupees.toFixed(2)}</td>
                    <td className="px-5 py-3 font-medium">₹{outstandingRupees.toFixed(2)}</td>
                    <td className={`px-5 py-3 font-bold ${availableRupees < 0 ? 'text-primary-600' : 'text-green-700'}`}>
                      ₹{availableRupees.toFixed(2)}
                    </td>
                    <td className="px-5 py-3 text-xs">{account?.allow_overdue ? 'Yes' : 'No'}</td>
                    <td className="px-5 py-3">
                      <Link
                        href={`/admin/wallets/${r.id}`}
                        className="rounded-lg border border-ink-200 px-3 py-1 text-xs font-medium hover:bg-ink-50"
                      >
                        Manage
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>How credit calculations work</CardTitle>
        </CardHeader>
        <div className="space-y-2 text-xs leading-5 text-ink-600">
          <p>
            <strong>Outstanding balance</strong> = frozen opening balance (pre-wallet) + total valid debit entries
            (ORDER_DEBIT, MANUAL_DEBIT, ADJUSTMENT) − total valid credit entries (PAYMENT_CREDIT, REFUND_CREDIT,
            MANUAL_CREDIT, ORDER_REVERSAL, ADJUSTMENT). The opening balance is frozen once and never added twice.
          </p>
          <p>
            <strong>Available credit</strong> = Credit limit minus outstanding balance. Uses integer paise for all
            calculations.
          </p>
          <p>
            <strong>Ledger</strong> is immutable — no transaction is ever deleted. Corrections use reversal/adjustment
            entries with audit reason.
          </p>
        </div>
      </Card>
    </div>
  );
}
