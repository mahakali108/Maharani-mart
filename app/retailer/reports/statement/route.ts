import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { requireUser } from '@/lib/auth/session';
import { formatIndiaDate, formatIndiaDateTime, indiaDayEnd, indiaDayStart, isValidIndiaDateKey } from '@/lib/datetime/india';
import {
  iteratePurchaseStatement,
  PURCHASE_STATEMENT_CSV_HEADER,
  statementCsvRow,
  streamCsvRows,
} from '@/lib/retailer/reports';
import { iterateRetailerLedgerStatement, type WalletTransaction } from '@/lib/retailer/wallet';

const TX_LABELS: Record<WalletTransaction['transaction_type'], string> = {
  ORDER_DEBIT: 'Order spend',
  PAYMENT_CREDIT: 'Payment received',
  REFUND_CREDIT: 'Coins refunded',
  MANUAL_CREDIT: 'Coins added (manual)',
  MANUAL_DEBIT: 'Coins used (manual)',
  // The database's historical CREDIT_LIMIT_CHANGE event now funds Coins.
  CREDIT_LIMIT_CHANGE: 'Coins added (funding)',
  ORDER_REVERSAL: 'Coins reversal',
  ADJUSTMENT: 'Coins adjustment',
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
  const fromRaw = url.searchParams.get('from');
  const toRaw = url.searchParams.get('to');
  if ((fromRaw && !isValidIndiaDateKey(fromRaw)) || (toRaw && !isValidIndiaDateKey(toRaw))) {
    return NextResponse.json({ error: 'Use a real calendar date in YYYY-MM-DD format.' }, { status: 400 });
  }
  const parseDate = (raw: string | null, fallback: Date, endOfIndiaDay = false) => {
    if (!raw) return fallback;
    // The filter is a calendar date in the retailer's Asia/Kolkata business
    // timezone, not UTC midnight. Include the whole selected end date.
    const parsed = endOfIndiaDay ? indiaDayEnd(raw) : indiaDayStart(raw);
    return parsed ?? fallback;
  };
  const from = parseDate(fromRaw, defaultFrom);
  const to = parseDate(toRaw, now, true);
  if (to.getTime() < from.getTime()) {
    return NextResponse.json({ error: 'The end date must be on or after the start date.' }, { status: 400 });
  }
  if (to.getTime() - from.getTime() > 2 * 365 * 24 * 60 * 60 * 1000) {
    return NextResponse.json({ error: 'Choose a range of two years or less.' }, { status: 400 });
  }

  const stamp = `${formatIndiaDate(from.toISOString())}_${formatIndiaDate(to.toISOString())}`.replace(/\s/g, '-');
  const filename = `maharani-${type}-statement-${stamp}.csv`;
  const ledgerHeader = 'Date (IST),Type,Direction,Amount (Rs),Reference';
  let csvStream: ReadableStream<Uint8Array>;

  try {
    const supabase = createClient();
    if (type === 'orders') {
      const iterator = iteratePurchaseStatement(
        supabase,
        user.id,
        from.toISOString(),
        to.toISOString()
      );
      const first = await iterator.next();
      csvStream = streamCsvRows(
        PURCHASE_STATEMENT_CSV_HEADER,
        first,
        iterator,
        statementCsvRow,
        (cause) => console.error('[retailer:reports.statement] Statement stream failed.', cause)
      );
    } else {
      const iterator = iterateRetailerLedgerStatement(
        supabase,
        user.id,
        from.toISOString(),
        to.toISOString()
      );
      const first = await iterator.next();
      csvStream = streamCsvRows(
        ledgerHeader,
        first,
        iterator,
        (tx) => [
          formatIndiaDateTime(tx.created_at),
          TX_LABELS[tx.transaction_type] ?? tx.transaction_type,
          tx.direction === 'credit' ? 'Added' : 'Used',
          (tx.amount_paise / 100).toFixed(2),
          tx.description ?? '',
        ].map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(','),
        (cause) => console.error('[retailer:reports.statement] Statement stream failed.', cause)
      );
    }
  } catch (cause) {
    console.error('[retailer:reports.statement] Statement query failed.', cause);
    return NextResponse.json({ error: 'The statement could not be prepared. Please try again.' }, { status: 503 });
  }

  return new NextResponse(csvStream, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  });
}
