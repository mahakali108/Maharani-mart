import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { requireUser } from '@/lib/auth/session';
import { formatIndiaDate, formatIndiaDateTime } from '@/lib/datetime/india';
import { loadPurchaseStatement, statementCsv } from '@/lib/retailer/reports';
import { getRetailerLedger, type WalletTransaction } from '@/lib/retailer/wallet';

const TX_LABELS: Record<WalletTransaction['transaction_type'], string> = {
  ORDER_DEBIT: 'Order debit',
  PAYMENT_CREDIT: 'Payment',
  REFUND_CREDIT: 'Refund',
  MANUAL_CREDIT: 'Manual credit',
  MANUAL_DEBIT: 'Manual debit',
  CREDIT_LIMIT_CHANGE: 'Credit limit change',
  ORDER_REVERSAL: 'Order reversal',
  ADJUSTMENT: 'Adjustment',
};

/**
 * CSV statement downloads for the retailer's OWN data. Auth is re-checked in
 * this route handler; every query runs through the caller's RLS-scoped
 * session, so only their own orders/ledger can ever be exported.
 */
export async function GET(request: Request) {
  const user = await requireUser();
  if (user.role !== 'retailer') {
    return NextResponse.json({ error: 'Only retailers can download statements.' }, { status: 403 });
  }

  const url = new URL(request.url);
  const type = url.searchParams.get('type') === 'ledger' ? 'ledger' : 'orders';
  const now = new Date();
  const defaultFrom = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
  const parseDate = (raw: string | null, fallback: Date) => {
    if (!raw || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return fallback;
    const parsed = new Date(`${raw}T00:00:00Z`);
    return Number.isNaN(parsed.getTime()) ? fallback : parsed;
  };
  const from = parseDate(url.searchParams.get('from'), defaultFrom);
  const to = parseDate(url.searchParams.get('to'), now);
  if (to.getTime() - from.getTime() > 2 * 365 * 24 * 60 * 60 * 1000) {
    return NextResponse.json({ error: 'Choose a range of two years or less.' }, { status: 400 });
  }

  const supabase = createClient();
  const stamp = `${formatIndiaDate(from.toISOString())}_${formatIndiaDate(to.toISOString())}`.replace(/\s/g, '-');
  const filename = `maharani-${type}-statement-${stamp}.csv`;

  let csv: string;
  if (type === 'orders') {
    const rows = await loadPurchaseStatement(supabase, user.id, from.toISOString(), to.toISOString());
    csv = statementCsv(rows);
  } else {
    const ledger = await getRetailerLedger(supabase, user.id, 1000);
    const inRange = ledger.filter((tx) => {
      const at = new Date(tx.created_at).getTime();
      return at >= from.getTime() && at <= to.getTime();
    });
    const header = 'Date (IST),Type,Direction,Amount (Rs),Reference';
    const lines = inRange.map((tx) =>
      [
        formatIndiaDateTime(tx.created_at),
        TX_LABELS[tx.transaction_type] ?? tx.transaction_type,
        tx.direction === 'credit' ? 'Credit' : 'Debit',
        (tx.amount_paise / 100).toFixed(2),
        tx.description ?? '',
      ]
        .map((cell) => `"${String(cell).replace(/"/g, '""')}"`)
        .join(',')
    );
    csv = [header, ...lines].join('\n');
  }

  return new NextResponse(csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  });
}
