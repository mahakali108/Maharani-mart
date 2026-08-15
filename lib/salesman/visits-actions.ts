'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { requireSalesman } from '@/lib/salesman/guard';
import type { Database } from '@/types/database.types';

type VisitInsert = Database['public']['Tables']['visits']['Insert'];

export type VisitResult = { error?: string } | { success: true; visitId?: string };

export async function checkInVisitAction(
  retailerId: string,
  lat: number | null,
  lng: number | null
): Promise<VisitResult> {
  const user = await requireSalesman();
  const supabase = createClient();

  const { data: assignedRetailer } = await supabase
    .from('retailers')
    .select('id')
    .eq('id', retailerId)
    .eq('assigned_salesman_id', user.id)
    .maybeSingle<{ id: string }>();
  if (!assignedRetailer) return { error: 'This retailer is not assigned to you.' };

  const payload: VisitInsert = {
    salesman_id: user.id,
    retailer_id: retailerId,
    status: 'checked_in',
    check_in_at: new Date().toISOString(),
    check_in_lat: lat,
    check_in_lng: lng,
  };

  const { data, error } = await supabase
    .from('visits')
    .insert(payload as unknown as never)
    .select('id')
    .single<{ id: string }>();

  if (error) return { error: error.message };

  revalidatePath('/salesman/visits');
  revalidatePath('/salesman/routes');
  return { success: true, visitId: data.id };
}

export async function checkOutVisitAction(visitId: string, notes: string): Promise<VisitResult> {
  const user = await requireSalesman();
  const supabase = createClient();

  const { error } = await supabase
    .from('visits')
    .update({
      status: 'checked_out',
      check_out_at: new Date().toISOString(),
      notes: notes.trim() || null,
    } as unknown as never)
    .eq('id', visitId)
    .eq('salesman_id', user.id);

  if (error) return { error: error.message };

  revalidatePath('/salesman/visits');
  revalidatePath('/salesman/routes');
  return { success: true };
}

export async function skipVisitAction(retailerId: string, notes: string): Promise<VisitResult> {
  const user = await requireSalesman();
  const supabase = createClient();

  const { data: assignedRetailer } = await supabase
    .from('retailers')
    .select('id')
    .eq('id', retailerId)
    .eq('assigned_salesman_id', user.id)
    .maybeSingle<{ id: string }>();
  if (!assignedRetailer) return { error: 'This retailer is not assigned to you.' };

  const payload: VisitInsert = {
    salesman_id: user.id,
    retailer_id: retailerId,
    status: 'skipped',
    notes: notes.trim() || null,
  };

  const { error } = await supabase.from('visits').insert(payload as unknown as never);
  if (error) return { error: error.message };

  revalidatePath('/salesman/visits');
  revalidatePath('/salesman/routes');
  return { success: true };
}
