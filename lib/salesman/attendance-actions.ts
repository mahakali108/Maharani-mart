'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { requireSalesman } from '@/lib/salesman/guard';
import type { Database } from '@/types/database.types';

type AttendanceInsert = Database['public']['Tables']['attendance']['Insert'];

export type AttendanceResult = { error?: string } | { success: true };

function todayDate(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function checkInAction(lat: number | null, lng: number | null): Promise<AttendanceResult> {
  const user = await requireSalesman();
  const supabase = createClient();

  const { data: existing } = await supabase
    .from('attendance')
    .select('id')
    .eq('user_id', user.id)
    .eq('work_date', todayDate())
    .maybeSingle<{ id: string }>();

  if (existing) return { error: "You've already checked in today." };

  const payload: AttendanceInsert = {
    user_id: user.id,
    punch_in_at: new Date().toISOString(),
    punch_in_lat: lat,
    punch_in_lng: lng,
  };

  const { error } = await supabase.from('attendance').insert(payload as unknown as never);
  if (error) return { error: error.message };

  revalidatePath('/salesman/attendance');
  return { success: true };
}

export async function checkOutAction(lat: number | null, lng: number | null): Promise<AttendanceResult> {
  const user = await requireSalesman();
  const supabase = createClient();

  const { data: existing } = await supabase
    .from('attendance')
    .select('id, punch_out_at')
    .eq('user_id', user.id)
    .eq('work_date', todayDate())
    .maybeSingle<{ id: string; punch_out_at: string | null }>();

  if (!existing) return { error: 'Check in before checking out.' };
  if (existing.punch_out_at) return { error: "You've already checked out today." };

  const { error } = await supabase
    .from('attendance')
    .update({ punch_out_at: new Date().toISOString(), punch_out_lat: lat, punch_out_lng: lng } as unknown as never)
    .eq('id', existing.id);

  if (error) return { error: error.message };

  revalidatePath('/salesman/attendance');
  return { success: true };
}
