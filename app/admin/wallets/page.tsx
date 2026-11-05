import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { ReadFailureNotice } from '@/components/ui/read-failure-notice';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { rupeesToPaise, paiseToRupees } from '@/lib/retailer/wallet';
import { computeAvailablePaise } from '@/lib/retailer/wallet-math';
import { readAdminWalletOutstanding, type WalletBalanceRpcClient } from '@/lib/admin/wallet-balance';
import { throwIfReadFailed } from '@/lib/supabase/read-guard';

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
  searchParams: searchParamsPromise,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const searchParams = await searchParamsPromise;
  const supabase = (await createClient());
  const q = (searchParams.q ?? '').trim();

  let query = supabase
    .from('retailers')
    .select('id, shop_name, status, credit_limit, outstanding_balance, created_at')
    .order('created_at', { ascending: false })
    .limit(100);

  if (q) {
    query = query.ilike('shop_name', `%${q}%`);
  }

  const { data: retailers, error: retailersError } = await query.returns<RetailerRow[]>();
  const retailerIds = (retailers ?? []).map((r) => r.id);
  // Restrict both related reads to the visible retailers; an unfiltered account
  // query can itself be silently truncated by the PostgREST row limit.
  const [accountResult, profileResult] = retailerIds.length > 0
    ? await Promise.all([
        supabase.from('retailer_credit_accounts')
          .select('retailer_id, credit_limit_paise, opening_outstanding_paise, allow_overdue')
          .in('retailer_id', retailerIds).returns<CreditAccountRow[]>(),
        supabase.from('profiles').select('id, full_name, phone')
          .in('id', retailerIds).returns<{ id: string; full_name: string; phone: string }[]>(),
      ])
    : [{ data: [] as CreditAccountRow[], error: null },
       { data: [] as { id: string; full_name: string; phone: string }[], error: null }];
  throwIfReadFailed(accountResult.error, 'Retailer credit accounts');
  throwIfReadFailed(profileResult.error, 'Retailer profiles');
  const creditAccounts = accountResult.data;
  const profileData = profileResult.data;

  const readFailed = Boolean(retailersError);
  const profileById = new Map((profileData ?? []).map((p) => [p.id, p]));
  const accountByRetailer = new Map((creditAccounts ?? []).map((a) => [a.retailer_id, a]));

  // The RPC sums the entire ledger on the database, avoiding PostgREST row
  // limits. It still has the known legacy reversal-flag defect; see notice.
  const balanceByRetailer = new Map(await Promise.all(retailerIds.map(async (id) => [
    id,
    await readAdminWalletOutstanding(supabase as unknown as WalletBalanceRpcClient, id),
  ] as const)));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-ink-950">🪙 Retailer coins</h1>
        <p className="mt-1 text-sm text-ink-500">
          The coin balance each shop can spend, funded by you and spent on orders — with every top-up, deduction and
          refund recorded in the ledger with a reason and an actor. Maharani Traders does not extend retailer credit.
        </p>
      </div>

      <p role="alert" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
        Wallet balances may be incorrect for refunded orders because of a known legacy accounting defect.
        Do not use these amounts for financial reconciliation until reviewed.
      </p>
      <Card>
        <CardHeader>
          <CardTitle>Find a shop by name</CardTitle>
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

      {readFailed ? (
        <ReadFailureNotice
          what="Retailer credit accounts"
          detail={retailersError?.message}
          hint="Credit limits and outstanding balances below are NOT authoritative until this loads."
        />
      ) : null}

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
                <th className="px-5 py-2 font-medium">Coin funding</th>
                <th className="px-5 py-2 font-medium">Coins spent</th>
                <th className="px-5 py-2 font-medium">🪙 Coins available</th>
                <th className="px-5 py-2 font-medium">Overdue policy</th>
                <th className="px-5 py-2 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-100">
              {(retailers ?? []).map((r) => {
                const profile = profileById.get(r.id);
                const account = accountByRetailer.get(r.id);
                const limitPaise = account?.credit_limit_paise ?? rupeesToPaise(r.credit_limit);
                const outstandingPaise = balanceByRetailer.get(r.id);
                if (outstandingPaise === undefined) throw new Error('Retailer wallet balance is unavailable.');
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
                            ? 'bg-mint-50 text-mint-700'
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
                    <td className={`px-5 py-3 font-bold ${availableRupees < 0 ? 'text-primary-600' : 'text-mint-700'}`}>
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
          <CardTitle>How coin calculations work</CardTitle>
        </CardHeader>
        <div className="space-y-2 text-xs leading-5 text-ink-600">
          <p>
            <strong>🪙 Coins spent</strong> = frozen opening balance (pre-wallet) + total valid debit entries
            (ORDER_DEBIT, MANUAL_DEBIT, ADJUSTMENT) − total valid credit entries (PAYMENT_CREDIT, REFUND_CREDIT,
            MANUAL_CREDIT, ORDER_REVERSAL, ADJUSTMENT). The opening balance is frozen once and never added twice, so
            historical amounts are never counted again.
          </p>
          <p>
            <strong>🪙 Coins available</strong> = coin funding minus coins spent, floored at zero — 1 coin = ₹1, in
            integer paise. Orders spend min(coins available, order total) and the rest is payable on delivery; a shop
            can never spend more than it holds.
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
