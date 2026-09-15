import { redirect } from 'next/navigation';
import { getRetailerShoppingContext } from '@/lib/retailer/shopping-context';
import { createClient } from '@/lib/supabase/server';
import { RetailerShell } from '@/components/layout/retailer-shell';

export default async function RetailerLayout({ children }: { children: React.ReactNode }) {
  const { user, retailer, areaName } = await getRetailerShoppingContext();
  // Defense in depth alongside middleware and Supabase RLS.
  if (user.role !== 'retailer') redirect('/unauthorized');
  if (retailer?.status === 'pending_approval') redirect('/pending-approval');
  if (retailer?.status === 'suspended') redirect('/login?error=account_suspended');
  const supabase = createClient();

  const [{ count: cartCount }, { count: unreadCount }] = await Promise.all([
    supabase
      .from('cart_items')
      .select('id', { count: 'exact', head: true })
      .eq('retailer_id', user.id),
    supabase
      .from('notifications')
      .select('id', { count: 'exact', head: true })
      .eq('recipient_id', user.id)
      .eq('is_read', false),
  ]);

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
