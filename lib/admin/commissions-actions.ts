'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { requirePermission } from '@/lib/admin/guard';
import type { Database } from '@/types/database.types';
import {
  computeCommissionPaise,
  nextCommissionStatus,
  summarizeSalesBasis,
  validateTargetPeriod,
  type CommissionBasis,
} from '@/lib/admin/targets-shared';
import { indiaDayEndIso, indiaDayStartIso } from '@/lib/datetime/india';

export type CommissionActionResult = { error?: string } | { success: true };

type CommissionInsert = Database['public']['Tables']['staff_commissions']['Insert'];

interface CommissionRow {
  id: string;
  status: string;
  user_id: string;
}

const BASES: CommissionBasis[] = ['sales_value', 'collection_value'];

/**
 * Generates (or refreshes, while still draft) a commission record for one
 * user + period. The basis amount is computed from REAL orders the user
 * collected in the period — never from a client-supplied number.
 *
 * `collection_value` is only computable once payment collections exist
 * (Phase 4 migration 0044); until then it is rejected with a clear message
 * rather than fabricating a zero.
 */
export async function generateCommissionAction(input: {
  userId: string;
  periodStart: string;
  periodEnd: string;
  basis: CommissionBasis;
  ratePercent: number;
  notes?: string;
}): Promise<CommissionActionResult> {
  const user = await requirePermission('commissions.manage');

  if (!input.userId) return { error: 'Select a team member.' };
  if (!BASES.includes(input.basis)) return { error: 'Choose a valid commission basis.' };
  if (input.basis === 'collection_value') {
    return { error: 'Collection-based commissions unlock with the payments module (Phase 4).' };
  }
  if (!Number.isFinite(input.ratePercent) || input.ratePercent < 0 || input.ratePercent > 100) {
    return { error: 'Enter a rate between 0 and 100 percent.' };
  }

  const period = validateTargetPeriod('quarter', input.periodStart, input.periodEnd);
  // A commission period may also be a single month.
  if (!period.ok) {
    const month = validateTargetPeriod('month', input.periodStart, input.periodEnd);
    if (!month.ok) return { error: month.error };
  }

  const supabase = createClient();

  const { data: subject } = await supabase
    .from('profiles')
    .select('id, role')
    .eq('id', input.userId)
    .in('role', ['staff', 'salesman'])
    .maybeSingle<{ id: string }>();
  if (!subject) return { error: 'Commissions can only be generated for staff or sales executives.' };

  // Real sales in the period (IST day boundaries, UTC timestamps).
  const fromIso = indiaDayStartIso(input.periodStart);
  const toIso = indiaDayEndIso(input.periodEnd);
  if (!fromIso || !toIso) return { error: 'Enter valid period dates.' };

  const { data: orderData } = await supabase
    .from('orders')
    .select('grand_total, status')
    .eq('collected_by', subject.id)
    .gte('placed_at', fromIso)
    .lte('placed_at', toIso)
    .returns<{ grand_total: number; status: string }[]>();

  const basisRupees = summarizeSalesBasis(orderData ?? []);
  const computedPaise = computeCommissionPaise(basisRupees, input.ratePercent);

  const payload: CommissionInsert = {
    user_id: subject.id,
    period_start: input.periodStart,
    period_end: input.periodEnd,
    basis: input.basis,
    rate_percent: input.ratePercent,
    basis_amount_paise: Math.round(basisRupees * 100),
    computed_amount_paise: computedPaise,
    status: 'draft',
    notes: input.notes?.trim() || null,
    created_by: user.id,
  };

  const { error } = await supabase
    .from('staff_commissions')
    .upsert(payload as unknown as never, { onConflict: 'user_id,basis,period_start' });

  if (error) return { error: error.message };

  revalidatePath('/admin/commissions');
  revalidatePath('/salesman/commissions');
  return { success: true };
}

/** Draft → approved. Only the one forward transition is allowed. */
export async function approveCommissionAction(commissionId: string): Promise<CommissionActionResult> {
  const user = await requirePermission('commissions.manage');
  const supabase = createClient();

  const { data: existing } = await supabase
    .from('staff_commissions')
    .select('id, status')
    .eq('id', commissionId)
    .maybeSingle<CommissionRow>();
  if (!existing) return { error: 'Commission record not found.' };
  if (nextCommissionStatus(existing.status as 'draft' | 'approved' | 'paid') !== 'approved') {
    return { error: 'Only draft commission records can be approved.' };
  }

  const { error } = await supabase
    .from('staff_commissions')
    .update({
      status: 'approved',
      approved_by: user.id,
      approved_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    } as unknown as never)
    .eq('id', commissionId)
    .eq('status', 'draft');

  if (error) return { error: error.message };

  revalidatePath('/admin/commissions');
  revalidatePath('/salesman/commissions');
  return { success: true };
}

/** Approved → paid. Only the one forward transition is allowed. */
export async function markCommissionPaidAction(commissionId: string): Promise<CommissionActionResult> {
  await requirePermission('commissions.manage');
  const supabase = createClient();

  const { data: existing } = await supabase
    .from('staff_commissions')
    .select('id, status')
    .eq('id', commissionId)
    .maybeSingle<CommissionRow>();
  if (!existing) return { error: 'Commission record not found.' };
  if (nextCommissionStatus(existing.status as 'draft' | 'approved' | 'paid') !== 'paid') {
    return { error: 'Only approved commission records can be marked paid.' };
  }

  const { error } = await supabase
    .from('staff_commissions')
    .update({
      status: 'paid',
      paid_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    } as unknown as never)
    .eq('id', commissionId)
    .eq('status', 'approved');

  if (error) return { error: error.message };

  revalidatePath('/admin/commissions');
  revalidatePath('/salesman/commissions');
  return { success: true };
}
