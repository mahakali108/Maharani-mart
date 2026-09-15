import 'server-only';

import { cache } from 'react';
import { requireUser } from '@/lib/auth/session';
import { createClient } from '@/lib/supabase/server';

export interface ShoppingProfile {
  area_id: string | null;
  shop_name: string | null;
  address: string | null;
  status: 'active' | 'pending_approval' | 'suspended';
  areas: { name: string; district: string | null } | null;
}

/** Request-local only: the layout and home share a session/profile read, never
 * a cross-retailer cache. Cart mutations still refresh the server layout. */
export const getRetailerShoppingContext = cache(async () => {
  const user = await requireUser();
  const { data, error } = await createClient()
    .from('retailers')
    .select('area_id, shop_name, address, status, areas ( name, district )')
    .eq('id', user.id)
    .maybeSingle<ShoppingProfile>();
  const retailer = error ? null : data;
  const areaName = retailer?.areas
    ? [retailer.areas.name, retailer.areas.district].filter(Boolean).join(', ')
    : null;
  return { user, retailer, areaName, profileUnavailable: !!error };
});
