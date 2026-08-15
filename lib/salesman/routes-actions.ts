'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { requireSalesman } from '@/lib/salesman/guard';

export type RouteResult = { error?: string } | { success: true };

interface StopRow {
  id: string;
  sort_order: number;
}

/**
 * Swaps sort_order with the adjacent stop — same pattern used for
 * product images/packs (lib/admin/products-actions.ts). RLS
 * (route_customers_salesman_reorder, migration 0010) independently
 * restricts this to routes the calling salesman actually owns.
 */
export async function reorderRouteStopAction(
  routeId: string,
  stopId: string,
  direction: 'up' | 'down'
): Promise<RouteResult> {
  await requireSalesman();
  const supabase = createClient();

  const { data } = await supabase
    .from('route_customers')
    .select('id, sort_order')
    .eq('route_id', routeId)
    .order('sort_order')
    .returns<StopRow[]>();

  if (!data) return { error: 'Route not found.' };

  const index = data.findIndex((s) => s.id === stopId);
  const swapIndex = direction === 'up' ? index - 1 : index + 1;
  if (index === -1 || swapIndex < 0 || swapIndex >= data.length) return { success: true };

  const current = data[index];
  const swap = data[swapIndex];
  // See lib/admin/products-actions.ts's swapSortOrder for why this
  // explicit guard is required under noUncheckedIndexedAccess.
  if (!current || !swap) return { success: true };

  const [{ error: err1 }, { error: err2 }] = await Promise.all([
    supabase.from('route_customers').update({ sort_order: swap.sort_order } as unknown as never).eq('id', current.id),
    supabase.from('route_customers').update({ sort_order: current.sort_order } as unknown as never).eq('id', swap.id),
  ]);

  if (err1 || err2) return { error: (err1 ?? err2)?.message ?? 'Failed to reorder.' };

  revalidatePath('/salesman/routes');
  return { success: true };
}
