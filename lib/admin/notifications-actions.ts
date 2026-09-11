'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { requirePermission } from '@/lib/admin/guard';
import { createInAppNotification } from '@/lib/notifications/notify';
import { broadcastSchema, type BroadcastInput } from '@/lib/notifications/broadcast';

export type BroadcastResult =
  | { error: string }
  | { success: true; recipients: number; warning?: string };

/**
 * Sends an in-app notification to every member of the chosen audience.
 * Recipients are resolved server-side from real profiles/retailers rows;
 * the count is returned so the UI can confirm the real reach.
 */
export async function broadcastNotificationAction(input: BroadcastInput): Promise<BroadcastResult> {
  await requirePermission('notifications.broadcast');

  const parsed = broadcastSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Check the notification details.' };

  const supabase = createClient();

  let recipientIds: string[] = [];
  if (parsed.data.audience === 'all_retailers') {
    const { data } = await supabase
      .from('retailers')
      .select('id')
      .returns<{ id: string }[]>();
    recipientIds = (data ?? []).map((r) => r.id);
  } else if (parsed.data.audience === 'active_retailers') {
    const { data } = await supabase
      .from('retailers')
      .select('id')
      .eq('status', 'active')
      .returns<{ id: string }[]>();
    recipientIds = (data ?? []).map((r) => r.id);
  } else {
    // Salesmen or staff — resolved from profiles by role.
    const { data } = await supabase
      .from('profiles')
      .select('id')
      .eq('role', parsed.data.audience === 'all_salesmen' ? 'salesman' : 'staff')
      .eq('is_active', true)
      .returns<{ id: string }[]>();
    recipientIds = (data ?? []).map((p) => p.id);
  }

  if (recipientIds.length === 0) {
    return { error: 'This audience has no members yet — nothing was sent.' };
  }

  let sent = 0;
  let lastError: string | null = null;
  for (const recipientId of recipientIds) {
    try {
      await createInAppNotification({
        recipientId,
        title: parsed.data.title,
        body: parsed.data.body,
        linkUrl: parsed.data.linkUrl || undefined,
        category: parsed.data.category,
      });
      sent += 1;
    } catch (error) {
      lastError = error instanceof Error ? error.message : 'Unknown delivery error.';
    }
  }

  if (sent === 0) {
    return { error: lastError ?? 'The notification could not be delivered to anyone.' };
  }

  revalidatePath('/admin/notifications');
  return {
    success: true,
    recipients: sent,
    ...(lastError ? { warning: `Delivered to ${sent}, but some sends failed: ${lastError}` } : {}),
  };
}
