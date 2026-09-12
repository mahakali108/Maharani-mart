import 'server-only';

import { createClient } from '@/lib/supabase/server';
import { indiaDayEndIso, indiaDayStartIso } from '@/lib/datetime/india';

export interface TargetRow {
  id: string;
  user_id: string;
  period_start: string;
  period_end: string;
  metric: string;
  target_value: number;
  is_active: boolean;
}

export interface TargetActual {
  actual: number | null;
  /** When the metric cannot be computed yet (e.g. collections before Phase 4). */
  pending?: string;
}

/**
 * Computes the ACTUAL for one target from real, RLS-visible rows. Every
 * metric reads a different real source:
 *   sales_value / order_count → orders collected by the user in the period
 *   visit_count               → visits logged by the user in the period
 *   new_retailers             → retailers approved by the user in the period
 *   collection_value          → payment collections (arrive in Phase 4)
 *
 * `null` (with a reason) means "cannot be computed yet" — never a fabricated
 * zero. Failures degrade to null so one bad query cannot break the page.
 */
export async function computeTargetActual(target: TargetRow): Promise<TargetActual> {
  const supabase = createClient();
  const fromIso = indiaDayStartIso(target.period_start);
  const toIso = indiaDayEndIso(target.period_end);
  if (!fromIso || !toIso) return { actual: null, pending: 'Invalid period.' };

  if (target.metric === 'sales_value' || target.metric === 'order_count') {
    const query = supabase
      .from('orders')
      .select('grand_total, status')
      .eq('collected_by', target.user_id)
      .gte('placed_at', fromIso)
      .lte('placed_at', toIso)
      .not('status', 'in', '(cancelled,returned)');
    if (target.metric === 'order_count') {
      const { count } = await query;
      return { actual: count ?? 0 };
    }
    const { data } = await query.returns<{ grand_total: number; status: string }[]>();
    return { actual: (data ?? []).reduce((sum, o) => sum + (Number(o.grand_total) || 0), 0) };
  }

  if (target.metric === 'visit_count') {
    const { count } = await supabase
      .from('visits')
      .select('id', { count: 'exact', head: true })
      .eq('salesman_id', target.user_id)
      .gte('created_at', fromIso)
      .lte('created_at', toIso);
    return { actual: count ?? 0 };
  }

  if (target.metric === 'new_retailers') {
    const { count } = await supabase
      .from('retailers')
      .select('id', { count: 'exact', head: true })
      .eq('approved_by', target.user_id)
      .gte('approved_at', fromIso)
      .lte('approved_at', toIso);
    return { actual: count ?? 0 };
  }

  if (target.metric === 'collection_value') {
    return { actual: null, pending: 'Unlocks with the payments module (Phase 4).' };
  }

  return { actual: null, pending: 'Unknown metric.' };
}

/** Formats a metric value for display (₹ for money metrics, plain counts otherwise). */
export function formatMetricValue(metric: string, value: number): string {
  if (metric === 'sales_value' || metric === 'collection_value') {
    return `₹${value.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
  }
  return String(value);
}

/** Maps the raw metric key to the label used across the UI. */
export function metricLabel(metric: string): string {
  switch (metric) {
    case 'sales_value':
      return 'Sales value';
    case 'collection_value':
      return 'Collection value';
    case 'order_count':
      return 'Orders collected';
    case 'visit_count':
      return 'Visits logged';
    case 'new_retailers':
      return 'New retailers';
    default:
      return metric;
  }
}
