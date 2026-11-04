import { NextResponse } from 'next/server';
import {
  enforceRateLimit,
  jsonError,
  logServerError,
  newRequestId,
} from '@/lib/mobile';
import { requireRetailerCommerceSession } from '@/lib/mobile/commerce-route';
import { formatIndiaDate, formatIndiaDateTime, indiaDayEnd, indiaDayStart, isValidIndiaDateKey } from '@/lib/datetime/india';
import {
  iteratePurchaseStatement,
  PURCHASE_STATEMENT_CSV_HEADER,
  statementCsvRow,
  streamCsvRows,
} from '@/lib/retailer/reports';
import { iterateRetailerLedgerStatement, type WalletTransaction } from '@/lib/retailer/wallet';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

const TX_LABELS: Record<WalletTransaction['transaction_type'], string> = {
  ORDER_DEBIT: 'Order spend',
  PAYMENT_CREDIT: 'Payment received',
  REFUND_CREDIT: 'Coins refunded',
  MANUAL_CREDIT: 'Coins added (manual)',
  MANUAL_DEBIT: 'Coins used (manual)',
  CREDIT_LIMIT_CHANGE: 'Coins added (funding)',
  ORDER_REVERSAL: 'Coins reversal',
  ADJUSTMENT: 'Coins adjustment',
};

function selectedDate(raw: string | null, fallback: Date, end = false): Date {
  if (!raw || !isValidIndiaDateKey(raw)) {
    return fallback;
  }
  return (end ? indiaDayEnd(raw) : indiaDayStart(raw)) ?? fallback;
}

function csvResponse(csv: ReadableStream<Uint8Array>, type: 'orders' | 'ledger', from: Date, to: Date, requestId: string): Response {
  const stamp = `${formatIndiaDate(from.toISOString())}_${formatIndiaDate(to.toISOString())}`.replace(/\s/g, '-');
  const response = new NextResponse(csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="maharani-${type}-statement-${stamp}.csv"`,
      'Cache-Control': 'no-store',
      'X-Request-Id': requestId,
    },
  });
  return response;
}

/**
 * GET /api/mobile/v1/reports/statement?type=orders|ledger — authenticated CSV
 * for the caller's own data. The CSV is generated server-side from the same
 * helpers as the PWA; no client submits prices, balances or retailer ids.
 */
export async function GET(request: Request): Promise<Response> {
  const requestId = newRequestId();
  const auth = await requireRetailerCommerceSession(request, requestId, 'orders.view.own');
  if ('response' in auth) return auth.response;
  const limited = enforceRateLimit('read.orders', request, { requestId, keySuffix: auth.session.userId });
  if (limited) return limited;

  const url = new URL(request.url);
  const typeRaw = url.searchParams.get('type') ?? 'orders';
  if (typeRaw !== 'orders' && typeRaw !== 'ledger') {
    return jsonError('invalid_request', 'Choose an order or coin-ledger statement.', { status: 400, requestId });
  }
  const now = new Date();
  const defaultFrom = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
  const fromRaw = url.searchParams.get('from');
  const toRaw = url.searchParams.get('to');
  if ((fromRaw && !isValidIndiaDateKey(fromRaw)) || (toRaw && !isValidIndiaDateKey(toRaw))) {
    return jsonError('invalid_request', 'Use a real calendar date in YYYY-MM-DD format.', { status: 400, requestId });
  }
  const from = selectedDate(fromRaw, defaultFrom);
  const to = selectedDate(toRaw, now, true);
  if (to.getTime() < from.getTime()) {
    return jsonError('invalid_request', 'The end date must be on or after the start date.', { status: 400, requestId });
  }
  if (to.getTime() - from.getTime() > 2 * 365 * 24 * 60 * 60 * 1000) {
    return jsonError('invalid_request', 'Choose a range of two years or less.', { status: 400, requestId });
  }

  try {
    const supabase = auth.session.supabase as unknown as Awaited<ReturnType<typeof createClient>>;
    if (typeRaw === 'orders') {
      const iterator = iteratePurchaseStatement(
        supabase,
        auth.session.userId,
        from.toISOString(),
        to.toISOString()
      );
      const first = await iterator.next();
      const csv = streamCsvRows(
        PURCHASE_STATEMENT_CSV_HEADER,
        first,
        iterator,
        statementCsvRow,
        (cause) => logServerError('reports.statement.stream', requestId, cause)
      );
      return csvResponse(csv, 'orders', from, to, requestId);
    }

    const iterator = iterateRetailerLedgerStatement(
      supabase,
      auth.session.userId,
      from.toISOString(),
      to.toISOString()
    );
    const first = await iterator.next();
    const csv = streamCsvRows(
      'Date (IST),Type,Direction,Amount (Rs),Reference',
      first,
      iterator,
      (row) => [
        formatIndiaDateTime(row.created_at),
        TX_LABELS[row.transaction_type] ?? row.transaction_type,
        row.direction === 'credit' ? 'Added' : 'Used',
        (row.amount_paise / 100).toFixed(2),
        row.description ?? '',
      ].map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(','),
      (cause) => logServerError('reports.statement.stream', requestId, cause)
    );
    return csvResponse(csv, 'ledger', from, to, requestId);
  } catch (cause) {
    logServerError('reports.statement', requestId, cause);
    return jsonError('database_unavailable', 'The statement could not be prepared. Please try again.', {
      status: 503,
      requestId,
    });
  }
}
