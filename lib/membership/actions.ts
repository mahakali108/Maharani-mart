'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { requirePermission } from '@/lib/admin/guard';

export async function adminAssignRetailerMembershipAction(formData: FormData): Promise<void> {
  await requirePermission('pricing.manage');

  const retailerId = formData.get('retailerId')?.toString();
  const planId = formData.get('planId')?.toString();
  const notes = formData.get('notes')?.toString() || null;
  const paymentRef = formData.get('paymentRef')?.toString() || null;

  if (!retailerId || !planId) {
    throw new Error('Retailer ID and Plan ID are required.');
  }

  const supabase = createClient();
  const rawClient = supabase as unknown as {
    rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>;
  };

  const { error } = await rawClient.rpc('admin_set_retailer_membership', {
    p_retailer_id: retailerId,
    p_plan_id: planId,
    p_notes: notes,
    p_payment_ref: paymentRef,
  });

  if (error) {
    throw new Error(error.message);
  }

  revalidatePath('/admin/membership');
  revalidatePath('/retailer/membership');
}

export async function adminRecordLoyaltyPointsAction(formData: FormData): Promise<void> {
  await requirePermission('coins.manage');

  const retailerId = formData.get('retailerId')?.toString();
  const pointsStr = formData.get('points')?.toString();
  const entryType = formData.get('entryType')?.toString() || 'MANUAL_CREDIT';
  const reason = formData.get('reason')?.toString();

  if (!retailerId || !pointsStr || !reason) {
    throw new Error('Retailer, points, and reason are required.');
  }

  const points = parseInt(pointsStr, 10);
  if (isNaN(points) || points === 0) {
    throw new Error('Points must be a non-zero integer.');
  }

  const supabase = createClient();
  const rawClient = supabase as unknown as {
    rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>;
  };

  const idempotencyKey = `manual:${retailerId}:${Date.now()}`;
  const { error } = await rawClient.rpc('record_loyalty_points', {
    p_retailer_id: retailerId,
    p_points: points,
    p_entry_type: entryType,
    p_reason: reason,
    p_reference_type: 'manual',
    p_reference_id: null,
    p_idempotency_key: idempotencyKey,
  });

  if (error) {
    throw new Error(error.message);
  }

  revalidatePath('/admin/membership');
  revalidatePath('/retailer/membership');
}
