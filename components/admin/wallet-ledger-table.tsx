'use client';

import { useState, useTransition } from 'react';
import { formatIndiaDateTime } from '@/lib/datetime/india';
import { reverseTransactionAction } from '@/lib/admin/wallet-actions';

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

function formatRupees(paise: number): string {
  return `₹${(paise / 100).toFixed(2)}`;
}

export function WalletLedgerTable({ ledger, retailerId }: { ledger: LedgerRow[]; retailerId: string }) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleReverse(id: string) {
    const reason = prompt('Enter reason for reversal (min 5 chars):');
    if (!reason || reason.trim().length < 5) {
      alert('Reason required (min 5 chars)');
      return;
    }
    if (!confirm(`Reverse transaction ${id.slice(0, 8)}...? This will create a reversal entry.`)) return;
    setError(null);
    startTransition(async () => {
      const result = await reverseTransactionAction(id, retailerId, reason.trim());
      if ('error' in result) setError(result.error);
      else window.location.reload();
    });
  }

  if (ledger.length === 0) {
    return <p className="p-5 text-sm text-ink-500">No ledger entries yet. Orders and payments will appear here.</p>;
  }

  return (
    <div className="space-y-3">
      {error ? <p className="rounded-lg border border-primary-200 bg-primary-50 px-3 py-2 text-xs text-primary-700">{error}</p> : null}
      <div className="table-scroll">
        <table className="w-full min-w-[820px] text-sm">
          <thead className="border-b border-ink-100 bg-ink-50 text-left text-xs uppercase tracking-wide text-ink-500">
            <tr>
              <th className="px-4 py-2">Date</th>
              <th className="px-4 py-2">Type</th>
              <th className="px-4 py-2">Direction</th>
              <th className="px-4 py-2 text-right">Amount</th>
              <th className="px-4 py-2">Description</th>
              <th className="px-4 py-2">Reason</th>
              <th className="px-4 py-2">Ref</th>
              <th className="px-4 py-2">By</th>
              <th className="px-4 py-2">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-ink-100">
            {ledger.map((row) => (
              <tr key={row.id} className={row.is_reversed ? 'bg-ink-50 opacity-60' : ''}>
                <td className="whitespace-nowrap px-4 py-2 text-xs text-ink-500">{formatIndiaDateTime(row.created_at)}</td>
                <td className="px-4 py-2">
                  <span className="rounded-full bg-ink-100 px-2 py-0.5 text-[10px] font-bold">{row.transaction_type}</span>
                  {row.is_reversed ? <span className="ml-1 rounded-full bg-primary-100 px-2 py-0.5 text-[10px]">REVERSED</span> : null}
                </td>
                <td className="px-4 py-2">
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${row.direction === 'debit' ? 'bg-primary-50 text-primary-700' : 'bg-green-50 text-green-700'}`}>
                    {row.direction.toUpperCase()}
                  </span>
                </td>
                <td className="px-4 py-2 text-right font-medium">{formatRupees(row.amount_paise)}</td>
                <td className="max-w-[200px] truncate px-4 py-2 text-xs">{row.description}</td>
                <td className="max-w-[150px] truncate px-4 py-2 text-xs text-ink-500">{row.reason ?? '—'}</td>
                <td className="px-4 py-2 text-xs font-mono">
                  {row.reference_type ? `${row.reference_type}:${row.reference_id?.slice(0, 8) ?? '—'}` : '—'}
                </td>
                <td className="px-4 py-2 text-xs font-mono">{row.created_by?.slice(0, 8) ?? '—'}</td>
                <td className="px-4 py-2">
                  {!row.is_reversed && row.transaction_type !== 'CREDIT_LIMIT_CHANGE' ? (
                    <button
                      disabled={isPending}
                      onClick={() => handleReverse(row.id)}
                      className="rounded-lg border border-ink-200 px-2 py-1 text-[10px] font-bold hover:bg-ink-50 disabled:opacity-50"
                    >
                      Reverse
                    </button>
                  ) : (
                    <span className="text-[10px] text-ink-400">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="px-1 text-[11px] text-ink-400">
        Every balance-changing action requires amount, reason, confirmation, server-side authorization. Admin cannot delete transactions; use reversal.
      </p>
    </div>
  );
}
