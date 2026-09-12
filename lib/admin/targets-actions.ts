'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { requirePermission } from '@/lib/admin/guard';
import type { Database } from '@/types/database.types';
import {
  isTargetMetric,
  validateTargetPeriod,
  type TargetMetric,
  type TargetPeriodType,
} from '@/lib/admin/targets-shared';

export type TargetActionResult = { error?: string } | { success: true };

type TargetInsert = Database['public']['Tables']['staff_targets']['Insert'];

const PERIOD_TYPES: TargetPeriodType[] = ['month', 'quarter'];

/**
 * Creates or updates one target row. The unique key is
 * (user, metric, period start), so re-submitting the same target for the
 * same period updates the value instead of duplicating it — safe to retry.
 */
export async function setStaffTargetAction(input: {
  userId: string;
  periodType: TargetPeriodType;
  periodStart: string;
  periodEnd: string;
  metric: TargetMetric;
  targetValue: number;
}): Promise<TargetActionResult> {
  const user = await requirePermission('targets.manage');

  if (!input.userId) return { error: 'Select a team member.' };
  if (!PERIOD_TYPES.includes(input.periodType)) return { error: 'Choose a month or quarter period.' };
  if (!isTargetMetric(input.metric)) return { error: 'Choose a valid target metric.' };
  if (!Number.isFinite(input.targetValue) || input.targetValue < 0 || input.targetValue > 1_000_000_000) {
    return { error: 'Enter a target value between 0 and 1,000,000,000.' };
  }

  const period = validateTargetPeriod(input.periodType, input.periodStart, input.periodEnd);
  if (!period.ok) return { error: period.error };

  const supabase = createClient();

  // A target can only be set for a real staff/salesman profile — never for
  // a retailer or an arbitrary user id.
  const { data: subject } = await supabase
    .from('profiles')
    .select('id, role')
    .eq('id', input.userId)
    .in('role', ['staff', 'salesman'])
    .maybeSingle<{ id: string }>();
  if (!subject) return { error: 'Targets can only be set for staff or sales executives.' };

  const payload: TargetInsert = {
    user_id: subject.id,
    period_type: input.periodType,
    period_start: period.period.start,
    period_end: period.period.end,
    metric: input.metric,
    target_value: Math.round(input.targetValue * 100) / 100,
    is_active: true,
    created_by: user.id,
  };

  const { error } = await supabase
    .from('staff_targets')
    .upsert(payload as unknown as never, { onConflict: 'user_id,metric,period_start' });

  if (error) return { error: error.message };

  revalidatePath('/admin/targets');
  revalidatePath(`/admin/team/${subject.id}`);
  revalidatePath('/salesman/targets');
  return { success: true };
}

/** Deactivates a target (soft-off) — history is preserved, never deleted. */
export async function deactivateStaffTargetAction(targetId: string): Promise<TargetActionResult> {
  await requirePermission('targets.manage');
  if (!targetId) return { error: 'Target not found.' };

  const supabase = createClient();
  const { error } = await supabase
    .from('staff_targets')
    .update({ is_active: false, updated_at: new Date().toISOString() } as unknown as never)
    .eq('id', targetId)
    .eq('is_active', true);

  if (error) return { error: error.message };

  revalidatePath('/admin/targets');
  return { success: true };
}
