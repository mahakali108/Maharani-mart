'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { requireUser } from '@/lib/auth/session';

export type NotificationActionResult = { error?: string } | { success: true };

export async function markNotificationReadAction(notificationId: string): Promise<NotificationActionResult> {
  const user = await requireUser();
  if (!notificationId) return { error: 'Notification not found.' };

  const supabase = createClient();
  const { error } = await supabase
    .from('notifications')
    .update({ is_read: true } as unknown as never)
    .eq('id', notificationId)
    .eq('recipient_id', user.id);

  if (error) return { error: error.message };
  revalidatePath('/retailer/notifications');
  revalidatePath('/retailer', 'layout');
  return { success: true };
}

export async function markAllNotificationsReadAction(): Promise<NotificationActionResult> {
  const user = await requireUser();
  const supabase = createClient();
  const { error } = await supabase
    .from('notifications')
    .update({ is_read: true } as unknown as never)
    .eq('recipient_id', user.id)
    .eq('is_read', false);

  if (error) return { error: error.message };
  revalidatePath('/retailer/notifications');
  revalidatePath('/retailer', 'layout');
  return { success: true };
}
