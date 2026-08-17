import { requireUser } from '@/lib/auth/session';
import { createClient } from '@/lib/supabase/server';
import { RetailerShell } from '@/components/layout/retailer-shell';

export default async function RetailerLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
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
      role={user.role}
      cartCount={cartCount ?? 0}
      unreadCount={unreadCount ?? 0}
    >
      {children}
    </RetailerShell>
  );
}
