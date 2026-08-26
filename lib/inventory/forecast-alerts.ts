import 'server-only';

import { createClient } from '@/lib/supabase/server';
import { createInAppNotification } from '@/lib/notifications/notify';
import { runForecastPipeline } from '@/lib/ai/forecast/index';
import { generateForecastInsights } from '@/lib/ai/forecast/insights';

/**
 * Forecast-driven business alerts for admins.
 *
 * Complements the existing low-stock threshold alerts (lib/inventory/alerts.ts)
 * with demand-based signals: stock-out risk, reorder-needed, overstock and
 * dead-stock. Alerts are best-effort and never block or alter the underlying
 * data. Deduplication uses the same link_url marker + cooldown technique as
 * the existing low-stock alerts, so a signal is not re-notified each run.
 *
 * Security: runs as the server-side (service-role) client? No — it uses the
 * caller's RLS-scoped client so only authorized admins/staff can trigger it
 * and RLS still guards every read. It never writes business data; it only
 * pushes in-app notifications, which are permitted to staff+ recipients by
 * the existing notifications_authorized_insert policy.
 */

const ALERT_COOLDOWN_HOURS = 24;
const MAX_NOTIFICATIONS = 12;

function alertLink(kind: string, productId: string): string {
  return `/admin/inventory/forecast?risk=${kind}&product=${productId}`;
}

async function admins(supabase: ReturnType<typeof createClient>): Promise<string[]> {
  const { data } = await supabase
    .from('profiles')
    .select('id')
    .in('role', ['super_admin', 'admin'])
    .eq('is_active', true);
  return ((data ?? []) as { id: string }[]).map((profile) => profile.id);
}

/**
 * Evaluate forecast safety signals and notify admins. Best-effort; never
 * throws into the caller. Call it after a stock-changing operation or a
 * scheduled forecast run.
 */
export async function notifyForecastSignalsIfNeeded(options: { days?: number } = {}): Promise<void> {
  try {
    const supabase = createClient();
    const { summary } = await runForecastPipeline(supabase, { days: options.days ?? 30, limit: 60 });
    const insights = generateForecastInsights(summary).filter(
      (insight) => insight.severity === 'critical' || insight.severity === 'warning'
    );

    if (insights.length === 0) return;

    const adminIds = await admins(supabase);
    if (adminIds.length === 0) return;

    // Dedupe: skip any notification for the same product+kind already sent
    // (unread) within the cooldown window, using the link_url marker.
    const links = insights.slice(0, MAX_NOTIFICATIONS).map((insight) =>
      alertLink(insight.kind, insight.productId ?? 'global')
    );
    const since = new Date(Date.now() - ALERT_COOLDOWN_HOURS * 60 * 60 * 1000).toISOString();
    const { data: recent } = await supabase
      .from('notifications')
      .select('link_url')
      .in('link_url', links)
      .eq('is_read', false)
      .gte('created_at', since);
    const alreadySent = new Set(((recent ?? []) as { link_url: string }[]).map((row) => row.link_url));

    for (const insight of insights.slice(0, MAX_NOTIFICATIONS)) {
      const link = alertLink(insight.kind, insight.productId ?? 'global');
      if (alreadySent.has(link)) continue;
      const title = insight.severity === 'critical' ? `🔴 ${insight.title}` : `🟠 ${insight.title}`;
      const body = `${insight.detail} (${insight.trace})`;
      for (const adminId of adminIds) {
        await createInAppNotification({ recipientId: adminId, title, body, linkUrl: link }).catch(() => {
          /* best-effort */
        });
      }
    }
  } catch {
    // Forecast alerting must never break the primary operation.
  }
}
