'use server';

import { createClient } from '@/lib/supabase/server';
import { requireUser } from '@/lib/auth/session';
import { can } from '@/lib/permissions/permissions';
import { createInAppNotification } from '@/lib/notifications/notify';
import { runForecastPipeline } from '@/lib/ai/forecast/index';
import type { ForecastResult } from '@/lib/ai/forecast/types';
import {
  computeCreditRows,
  computeRiskCenter,
  addDays,
  type RawExpiryRow,
  type RawInventoryTotal,
  type RawRetailer,
} from './compute';
import { fetchOrders, fetchOrderItems } from './data';

/**
 * Smart Alerts — a Super Admin server action built on the EXISTING
 * notification infrastructure (notifications table + in-app realtime) and the
 * existing anti-spam technique used by lib/inventory/alerts.ts and
 * lib/inventory/forecast-alerts.ts: the dedupe marker lives in link_url and a
 * signal already sent (unread) within the cooldown window is not re-sent.
 *
 * It only writes in-app notifications addressed to super admins. It never
 * mutates inventory, credit, orders, pricing or retailer accounts.
 */

export interface SmartAlertSignal {
  kind: string;
  entityId: string;
  severity: 'urgent' | 'high' | 'medium';
  title: string;
  body: string;
  linkUrl: string;
}

export interface RunAlertsResult {
  ok: boolean;
  sent: number;
  deduped: number;
  signals: string[];
  error?: string;
}

const COOLDOWN_HOURS = 24;
const MAX_SIGNALS = 15;
const DEDUPE_LINK_PREFIX = '/admin/command-center/alerts?signal=';

function signalLink(kind: string, entityId: string): string {
  return `${DEDUPE_LINK_PREFIX}${encodeURIComponent(`${kind}:${entityId}`)}`;
}

async function collectSignals(supabase: ReturnType<typeof createClient>): Promise<SmartAlertSignal[]> {
  const now = new Date();
  const d30 = addDays(now, -30);
  const d7 = addDays(now, -7);
  const signals: SmartAlertSignal[] = [];

  const [totals, expiry, retailers, orders30, orders7] = await Promise.all([
    supabase
      .from('inventory_product_totals')
      .select('product_id, product_name, sku_code, quantity_on_hand, reserved_quantity, available_quantity, estimated_value, reorder_level, stock_status')
      .limit(5000),
    supabase
      .from('inventory_expiry_report')
      .select('batch_id, product_id, product_name, batch_number, warehouse_name, expiry_date, available_quantity, current_quantity, estimated_value, days_remaining, expiry_status')
      .neq('expiry_status', 'healthy')
      .order('days_remaining', { ascending: true })
      .limit(100),
    supabase.from('retailers').select('id, shop_name, status, credit_limit, outstanding_balance, created_at, approved_at').limit(5000),
    fetchOrders(supabase, d30.toISOString(), now.toISOString()),
    fetchOrders(supabase, d7.toISOString(), now.toISOString()),
  ]);
  if (totals.error || expiry.error || retailers.error) throw new Error('Business data is temporarily unavailable.');

  const totalsRows = (totals.data ?? []) as unknown as RawInventoryTotal[];
  const expiryRows = (expiry.data ?? []) as unknown as RawExpiryRow[];
  const retailerRows = (retailers.data ?? []) as unknown as RawRetailer[];
  const orders30Rows = orders30;
  const orders7Rows = orders7;

  // Low stock (configured reorder level only — same rule as lib/inventory/alerts.ts).
  for (const row of totalsRows.filter((t) => t.reorder_level > 0 && t.available_quantity <= t.reorder_level).slice(0, 6)) {
    signals.push({
      kind: 'low-stock',
      entityId: row.product_id,
      severity: row.available_quantity <= 0 ? 'urgent' : 'high',
      title: row.available_quantity <= 0 ? `Out of stock: ${row.product_name}` : `Low stock: ${row.product_name}`,
      body: `${row.available_quantity} unit(s) available vs reorder level ${row.reorder_level}. Review the reorder pipeline.`,
      linkUrl: signalLink('low-stock', row.product_id),
    });
  }

  // Batch expiry.
  for (const row of expiryRows.slice(0, 6)) {
    signals.push({
      kind: `expiry-${row.expiry_status}`,
      entityId: row.batch_id,
      severity: row.expiry_status === 'warning' ? 'high' : 'urgent',
      title: `${row.product_name} batch ${row.batch_number} is ${row.expiry_status}`,
      body: row.expiry_date
        ? `${row.available_quantity} unit(s) available · expires ${row.expiry_date} (${row.days_remaining ?? 0} days) · ${row.warehouse_name}.`
        : `${row.available_quantity} unit(s) available in ${row.warehouse_name}.`,
      linkUrl: signalLink(`expiry-${row.expiry_status}`, row.batch_id),
    });
  }

  // Credit over limit (shared authoritative calculator).
  const { rows: creditRows } = computeCreditRows(retailerRows);
  for (const row of creditRows.filter((r) => r.position.exceedsLimit).slice(0, 5)) {
    signals.push({
      kind: 'credit-over-limit',
      entityId: row.retailer.id,
      severity: 'urgent',
      title: `Credit over limit: ${row.retailer.shop_name}`,
      body: `Outstanding ₹${row.position.outstandingBalance.toLocaleString('en-IN')} exceeds the limit ₹${row.position.creditLimit.toLocaleString('en-IN')}.`,
      linkUrl: signalLink('credit-over-limit', row.retailer.id),
    });
  }

  // Forecast-based stock-out risk + unusual orders + system failures.
  let forecasts: ForecastResult[] = [];
  try {
    const pipeline = await runForecastPipeline(supabase, { days: 30, limit: 60 });
    forecasts = pipeline.summary.forecasts;
  } catch {
    // Forecast is best-effort here; the other signals still fire.
  }
  for (const f of forecasts.filter((f) => f.stockOutRisk === 'critical').slice(0, 4)) {
    signals.push({
      kind: 'stockout-critical',
      entityId: f.productId,
      severity: 'urgent',
      title: `Stock-out risk: ${f.productName}`,
      body: f.explanation,
      linkUrl: signalLink('stockout-critical', f.productId),
    });
  }

  const risk = computeRiskCenter({
    now,
    retailers: retailerRows,
    inventoryTotals: totalsRows,
    expiryRows: expiryRows,
    orders30d: orders30Rows,
    orders7d: orders7Rows,
    items30d: await (async () => {
      try {
        return await fetchOrderItems(supabase, orders30Rows.map((o) => o.id));
      } catch {
        return [];
      }
    })(),
    forecasts,
    aiAuditLogs: await (async () => {
      try {
        const { data } = await supabase.from('ai_audit_logs').select('id, tool_name, request_type, success, error_code, provider, created_at').gte('created_at', addDays(now, -7).toISOString()).limit(300);
        return (data ?? []) as unknown as Parameters<typeof computeRiskCenter>[0]['aiAuditLogs'];
      } catch {
        return [];
      }
    })(),
    failedNotifications7d: 0,
  });
  for (const item of risk.unusualOrders.items.slice(0, 3)) {
    signals.push({
      kind: 'unusual-order',
      entityId: item.id,
      severity: 'high',
      title: item.title,
      body: item.detail,
      linkUrl: signalLink('unusual-order', item.id),
    });
  }

  return signals.slice(0, MAX_SIGNALS);
}

export async function runCommandCenterSmartAlerts(): Promise<RunAlertsResult> {
  const user = await requireUser();
  if (!can(user.role, 'command_center.view')) {
    return { ok: false, sent: 0, deduped: 0, signals: [], error: 'Super Admin access is required.' };
  }

  const supabase = createClient();
  let signals: SmartAlertSignal[];
  try {
    signals = await collectSignals(supabase);
  } catch (error) {
    return { ok: false, sent: 0, deduped: 0, signals: [], error: error instanceof Error ? error.message : 'Alert generation failed.' };
  }

  const { data: superAdmins } = await supabase
    .from('profiles')
    .select('id')
    .eq('role', 'super_admin')
    .eq('is_active', true);
  const recipients = ((superAdmins ?? []) as { id: string }[]).map((p) => p.id);
  if (recipients.length === 0) {
    return { ok: false, sent: 0, deduped: 0, signals: [], error: 'No active Super Admin profiles found.' };
  }

  // Dedupe against signals already sent (unread) inside the cooldown window.
  const links = signals.map((s) => s.linkUrl);
  const since = new Date(Date.now() - COOLDOWN_HOURS * 3_600_000).toISOString();
  const { data: recent } = await supabase
    .from('notifications')
    .select('link_url')
    .in('link_url', links)
    .eq('is_read', false)
    .gte('created_at', since);
  const alreadySent = new Set(((recent ?? []) as { link_url: string }[]).map((r) => r.link_url));

  let sent = 0;
  let deduped = 0;
  const titles: string[] = [];
  for (const signal of signals) {
    if (alreadySent.has(signal.linkUrl)) {
      deduped += 1;
      continue;
    }
    const prefix = signal.severity === 'urgent' ? '🔴' : signal.severity === 'high' ? '🟠' : '🔵';
    for (const recipientId of recipients) {
      try {
        await createInAppNotification({
          recipientId,
          title: `${prefix} ${signal.title}`,
          body: signal.body,
          linkUrl: signal.linkUrl,
        });
      } catch {
        // Best-effort, same as the existing alert modules.
      }
    }
    sent += 1;
    titles.push(signal.title);
  }

  return { ok: true, sent, deduped, signals: titles };
}
