import { requireUser } from '@/lib/auth/session';
import { createClient } from '@/lib/supabase/server';
import { RetailerShell } from '@/components/layout/retailer-shell';

interface RetailerAreaRow {
  area_id: string | null;
  areas: { name: string; district: string | null } | null;
}

export default async function RetailerLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const supabase = createClient();

  const [{ count: cartCount }, { count: unreadCount }, { data: retailerRow }] = await Promise.all([
    supabase
      .from('cart_items')
      .select('id', { count: 'exact', head: true })
      .eq('retailer_id', user.id),
    supabase
      .from('notifications')
      .select('id', { count: 'exact', head: true })
      .eq('recipient_id', user.id)
      .eq('is_read', false),
    // The retailer's own area is read with their RLS-scoped session. It feeds
    // the delivery-area pill in the header; we keep the area_id null-safe so
    // an unassigned account still renders the rest of the shell.
    supabase
      .from('retailers')
      .select('area_id, areas ( name, district )')
      .eq('id', user.id)
      .maybeSingle<RetailerAreaRow>(),
  ]);

  const area = retailerRow?.areas;
  const areaName = area
    ? area.district
      ? `${area.name}, ${area.district}`
      : area.name
    : null;

  return (
    <RetailerShell
      fullName={user.fullName}
      areaName={areaName}
      role={user.role}
      cartCount={cartCount ?? 0}
      unreadCount={unreadCount ?? 0}
    >
      {children}
    </RetailerShell>
  );
}
