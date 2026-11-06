import {
  enforceRateLimit,
  jsonError,
  jsonOk,
  logServerError,
  newRequestId,
} from '@/lib/mobile';
import { requireRetailerCommerceSession } from '@/lib/mobile/commerce-route';
import { loadInsightWindows, loadMostPurchased, loadSpendTrend } from '@/lib/retailer/reports';
import { getRetailerWalletSummary } from '@/lib/retailer/wallet';
import { toPaise } from '@/lib/retailer/case-pricing';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

function mapProduct(product: {
  productId: string;
  name: string;
  brandName: string | null;
  totalPieces: number;
  totalValue: number;
  orderCount: number;
}) {
  return {
    productId: product.productId,
    name: product.name,
    brandName: product.brandName,
    totalPieces: product.totalPieces,
    totalValuePaise: toPaise(product.totalValue),
    orderCount: product.orderCount,
  };
}

function mapWindow(window: Awaited<ReturnType<typeof loadInsightWindows>>['week']) {
  return {
    totals: {
      orderCount: window.totals.orderCount,
      purchaseValuePaise: toPaise(window.totals.purchaseValue),
      gstTotalPaise: toPaise(window.totals.gstTotal),
      discountTotalPaise: toPaise(window.totals.discountTotal),
    },
    topProducts: window.topProducts.map(mapProduct),
  };
}

/**
 * GET /api/mobile/v1/reports — purchase summaries built from the caller's own
 * orders/ledger with the same aggregators as the PWA. Amounts cross the API in
 * integer paise; cancelled orders stay excluded by the shared report helper.
 */
export async function GET(request: Request): Promise<Response> {
  const requestId = newRequestId();
  const auth = await requireRetailerCommerceSession(request, requestId, 'orders.view.own');
  if ('response' in auth) return auth.response;
  const limited = enforceRateLimit('read.orders', request, { requestId, keySuffix: auth.session.userId });
  if (limited) return limited;

  try {
    const supabase = auth.session.supabase as unknown as Awaited<ReturnType<typeof createClient>>;
    const [windows, trend, mostPurchased, wallet] = await Promise.all([
      loadInsightWindows(supabase, auth.session.userId),
      loadSpendTrend(supabase, auth.session.userId),
      loadMostPurchased(supabase, auth.session.userId),
      getRetailerWalletSummary(supabase, auth.session.userId),
    ]);
    return jsonOk({
      week: mapWindow(windows.week),
      month: mapWindow(windows.month),
      trend: trend.map((row) => ({
        monthKey: row.monthKey,
        label: row.label,
        orderCount: row.orderCount,
        purchaseValuePaise: toPaise(row.purchaseValue),
      })),
      mostPurchased: mostPurchased.map(mapProduct),
      coins: {
        coinsFundedPaise: wallet.creditLimitPaise,
        coinsSpentPaise: wallet.outstandingPaise,
        coinsAvailablePaise: Math.max(0, wallet.creditLimitPaise - wallet.outstandingPaise),
      },
    }, { requestId });
  } catch (cause) {
    logServerError('reports', requestId, cause);
    return jsonError('database_unavailable', 'Purchase reports could not be loaded. Please try again.', {
      status: 503,
      requestId,
    });
  }
}
