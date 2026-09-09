import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { WalletBalanceCards } from '@/components/admin/wallet-balance-cards';
import { WalletLedgerTable } from '@/components/admin/wallet-ledger-table';
import { WalletPaymentForm } from '@/components/admin/wallet-payment-form';
import { WalletAdjustmentForm } from '@/components/admin/wallet-adjustment-form';
import { WalletLimitForm } from '@/components/admin/wallet-limit-form';
import { rupeesToPaise, paiseToRupees } from '@/lib/retailer/wallet';
import { formatIndiaDateTime } from '@/lib/datetime/india';

interface RetailerDetail {
  id: string;
  shop_name: string;
  gstin: string | null;
  credit_limit: number;
  outstanding_balance: number;
  status: string;
}

interface CreditAccountDetail {
  id: string;
  retailer_id: string;
  credit_limit_paise: number;
  allow_overdue: boolean;
  overdue_limit_paise: number;
  created_at: string;
  updated_at: string;
  notes: string | null;
}

interface LedgerRow {
  id: string;
  transaction_type: string;
  amount_paise: number;
  direction: string;
  reference_type: string | null;
  reference_id: string | null;
  description: string;
  reason: string | null;
  created_at: string;
  created_by: string | null;
  notes: string | null;
  idempotency_key: string | null;
  is_reversed: boolean;
  metadata: Record<string, unknown> | null;
}

interface OrderRow {
  id: string;
  order_number: string;
  grand_total: number;
  status: string;
  placed_at: string;
}

export default async function AdminWalletDetailPage({ params }: { params: { id: string } }) {
  const supabase = createClient();

  const [{ data: retailer }, { data: creditAccount }, { data: ledgerData }, { data: orderData }, { data: profile }] =
    await Promise.all([
      supabase
        .from('retailers')
        .select('id, shop_name, gstin, credit_limit, outstanding_balance, status')
        .eq('id', params.id)
        .maybeSingle<RetailerDetail>(),
      supabase
        .from('retailer_credit_accounts')
        .select('id, retailer_id, credit_limit_paise, allow_overdue, overdue_limit_paise, created_at, updated_at, notes')
        .eq('retailer_id', params.id)
        .maybeSingle<CreditAccountDetail>(),
      supabase
        .from('retailer_wallet_ledger')
        .select(
          'id, transaction_type, amount_paise, direction, reference_type, reference_id, description, reason, created_at, created_by, notes, idempotency_key, is_reversed, metadata'
        )
        .eq('retailer_id', params.id)
        .order('created_at', { ascending: false })
        .limit(100)
        .returns<LedgerRow[]>(),
      supabase
        .from('orders')
        .select('id, order_number, grand_total, status, placed_at')
        .eq('retailer_id', params.id)
        .order('placed_at', { ascending: false })
        .limit(20)
        .returns<OrderRow[]>(),
      supabase.from('profiles').select('full_name, phone').eq('id', params.id).maybeSingle<{ full_name: string; phone: string }>(),
    ]);

  if (!retailer) notFound();

  const ledger = ledgerData ?? [];
  const orders = orderData ?? [];

  // Calculate balances from ledger + legacy
  const ledgerDebit = ledger
    .filter((l) => !l.is_reversed && l.direction === 'debit' && l.transaction_type !== 'CREDIT_LIMIT_CHANGE')
    .reduce((sum, l) => sum + Number(l.amount_paise), 0);
  const ledgerCredit = ledger
    .filter((l) => !l.is_reversed && l.direction === 'credit' && l.transaction_type !== 'CREDIT_LIMIT_CHANGE')
    .reduce((sum, l) => sum + Number(l.amount_paise), 0);

  const legacyOutstandingPaise = rupeesToPaise(retailer.outstanding_balance);
  const limitPaise = creditAccount?.credit_limit_paise ?? rupeesToPaise(retailer.credit_limit);
  const outstandingPaise = legacyOutstandingPaise + ledgerDebit - ledgerCredit;
  const availablePaise = limitPaise - outstandingPaise;

  const totalCreditGranted = paiseToRupees(limitPaise);
  const totalUsed = paiseToRupees(ledgerDebit + legacyOutstandingPaise);
  const totalPaidBack = paiseToRupees(ledgerCredit);
  const overduePaise = outstandingPaise > limitPaise ? outstandingPaise - limitPaise : 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2 text-sm text-ink-500">
        <Link href="/admin/wallets" className="hover:text-ink-900">
          Wallets
        </Link>
        <span>/</span>
        <span className="text-ink-900">{retailer.shop_name}</span>
      </div>

      <div>
        <h1 className="text-2xl font-semibold text-ink-950">{retailer.shop_name} — Credit Account</h1>
        <p className="mt-1 text-sm text-ink-500">
          {profile?.full_name ?? '—'} {profile?.phone ? `· ${profile.phone}` : ''} · {retailer.status} · GSTIN:{' '}
          {retailer.gstin ?? '—'}
        </p>
      </div>

      <WalletBalanceCards
        creditLimit={paiseToRupees(limitPaise)}
        outstanding={paiseToRupees(outstandingPaise)}
        available={paiseToRupees(availablePaise)}
        totalUsed={totalUsed}
        totalPaidBack={totalPaidBack}
        totalCreditGranted={totalCreditGranted}
        overdue={paiseToRupees(overduePaise)}
        allowOverdue={creditAccount?.allow_overdue ?? false}
      />

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Set / Change Credit Limit</CardTitle>
          </CardHeader>
          <WalletLimitForm
            retailerId={retailer.id}
            currentLimit={paiseToRupees(limitPaise)}
            currentOutstanding={paiseToRupees(outstandingPaise)}
            allowOverdue={creditAccount?.allow_overdue ?? false}
            overdueLimit={paiseToRupees(creditAccount?.overdue_limit_paise ?? 0)}
          />
          {creditAccount ? (
            <p className="mt-3 text-xs text-ink-400">
              Last updated: {formatIndiaDateTime(creditAccount.updated_at)} · Notes: {creditAccount.notes ?? '—'}
            </p>
          ) : null}
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Record Customer Payment</CardTitle>
          </CardHeader>
          <WalletPaymentForm retailerId={retailer.id} />
          <p className="mt-2 text-[11px] text-ink-400">
            Payments create a ledger credit entry, update outstanding and available credit through server-side
            calculation, are auditable, prevent duplicate submission, and validate amount and retailer identity.
          </p>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Credit Adjustment</CardTitle>
        </CardHeader>
        <WalletAdjustmentForm retailerId={retailer.id} />
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Complete Ledger (last 100)</CardTitle>
          <Link href={`/admin/retailers/${retailer.id}`} className="text-xs text-primary-600">
            View retailer profile →
          </Link>
        </CardHeader>
        <WalletLedgerTable ledger={ledger} retailerId={retailer.id} />
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Linked Orders & Invoices (last 20)</CardTitle>
        </CardHeader>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-ink-100 bg-ink-50 text-left text-xs uppercase tracking-wide text-ink-500">
              <tr>
                <th className="px-5 py-2">Order</th>
                <th className="px-5 py-2">Date</th>
                <th className="px-5 py-2">Status</th>
                <th className="px-5 py-2 text-right">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-100">
              {orders.map((o) => (
                <tr key={o.id}>
                  <td className="px-5 py-2">
                    <Link href={`/admin/orders/${o.id}`} className="font-mono text-xs text-primary-600">
                      {o.order_number}
                    </Link>
                  </td>
                  <td className="px-5 py-2 text-xs text-ink-400">{formatIndiaDateTime(o.placed_at)}</td>
                  <td className="px-5 py-2 text-xs">{o.status}</td>
                  <td className="px-5 py-2 text-right font-medium">₹{o.grand_total.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
