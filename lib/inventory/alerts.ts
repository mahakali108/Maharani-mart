import 'server-only';

import { createClient } from '@/lib/supabase/server';
import { createInAppNotification } from '@/lib/notifications/notify';

/**
 * Low-stock alerting built on the existing notification infrastructure.
 *
 * Anti-spam rules:
 *   - alerts only fire for products with a configured reorder_level (> 0);
 *   - one unread alert per product per cooldown window (default 24h,
 *     configurable in inventory_settings);
 *   - the dedupe marker lives in link_url, so no extra tables are needed.
 *
 * Best-effort by design: a failure to alert must never break the stock
 * operation that caused it.
 */

interface AdminRecipient {
  id: string;
}

interface ProductAlertCheck {
  id: string;
  name: string;
  reorder_level: number;
  available: number;
}

function dedupeLink(productId: string): string {
  return `/admin/inventory/low-stock?product=${productId}`;
}

/**
 * Checks the given products and notifies admin/super_admin users about any
 * that are at/below their reorder level (or out of stock entirely).
 * Call after stock-decreasing operations (dispatch, adjustment, loss).
 */
export async function notifyLowStockIfNeeded(productIds: string[]): Promise<void> {
  const unique = [...new Set(productIds.filter(Boolean))];
  if (unique.length === 0) return;

  try {
    const supabase = createClient();

    const [{ data: settingsData }, { data: productData }, { data: stockData }] = await Promise.all([
      supabase.from('inventory_settings').select('low_stock_alert_cooldown_hours').maybeSingle(),
      supabase
        .from('products')
        .select('id, name, reorder_level')
        .in('id', unique),
      supabase
        .from('inventory_stock')
        .select('product_id, quantity, reserved_quantity')
        .in('product_id', unique),
    ]);

    const products = (productData ?? []) as unknown as { id: string; name: string; reorder_level: number }[];
    if (products.length === 0) return;

    const availableByProduct = new Map<string, number>();
    for (const row of (stockData ?? []) as unknown as { product_id: string; quantity: number; reserved_quantity: number }[]) {
      availableByProduct.set(
        row.product_id,
        (availableByProduct.get(row.product_id) ?? 0) + (row.quantity - row.reserved_quantity)
      );
    }

    const cooldownHours = (settingsData as unknown as { low_stock_alert_cooldown_hours?: number } | null)
      ?.low_stock_alert_cooldown_hours ?? 24;
    const since = new Date(Date.now() - cooldownHours * 60 * 60 * 1000).toISOString();

    const candidates: ProductAlertCheck[] = products
      .map((p) => ({
        id: p.id,
        name: p.name,
        reorder_level: p.reorder_level,
        available: availableByProduct.get(p.id) ?? 0,
      }))
      .filter((p) => p.reorder_level > 0 && p.available <= p.reorder_level);

    if (candidates.length === 0) return;

    // Dedupe: skip products that already received an unread alert within
    // the cooldown window (link_url carries the product marker).
    const links = candidates.map((p) => dedupeLink(p.id));
    const { data: recent } = await supabase
      .from('notifications')
      .select('link_url, created_at')
      .in('link_url', links)
      .eq('is_read', false)
      .gte('created_at', since);

    const alreadyAlerted = new Set(((recent ?? []) as unknown as { link_url: string }[]).map((r) => r.link_url));
    const toAlert = candidates.filter((p) => !alreadyAlerted.has(dedupeLink(p.id)));
    if (toAlert.length === 0) return;

    const { data: adminData } = await supabase
      .from('profiles')
      .select('id')
      .in('role', ['super_admin', 'admin'])
      .eq('is_active', true);
    const admins = ((adminData ?? []) as unknown as AdminRecipient[]).map((a) => a.id);
    if (admins.length === 0) return;

    for (const p of toAlert) {
      const out = p.available <= 0;
      const title = out ? `Out of stock: ${p.name}` : `Low stock: ${p.name}`;
      const body = out
        ? `${p.name} has no available stock left. Reorder now to avoid lost sales.`
        : `${p.name} is down to ${p.available} available unit(s) — at or below its reorder level of ${p.reorder_level}.`;
      for (const adminId of admins) {
        await createInAppNotification({
          recipientId: adminId,
          title,
          body,
          linkUrl: dedupeLink(p.id),
        }).catch(() => {
          /* best-effort */
        });
      }
    }
  } catch {
    // Alerting must never break the primary operation.
  }
}
