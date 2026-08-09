'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createClient, createServiceRoleClient } from '@/lib/supabase/server';
import { requirePermission } from '@/lib/admin/guard';
import type { Database } from '@/types/database.types';

export type TeamFormState = { error?: string } | null;

type ProfileUpdate = Database['public']['Tables']['profiles']['Update'];
type StaffAssignmentInsert = Database['public']['Tables']['staff_assignments']['Insert'];

const staffSchema = z.object({
  fullName: z.string().min(2, 'Enter a full name.'),
  phone: z.string().regex(/^[6-9]\d{9}$/, 'Enter a valid 10-digit Indian mobile number.'),
  email: z.string().email('Enter a valid email address.'),
  password: z.string().min(8, 'Password must be at least 8 characters.'),
  role: z.enum(['staff', 'salesman']),
  areaId: z.string().uuid().optional().or(z.literal('')),
  warehouseId: z.string().uuid().optional().or(z.literal('')),
});

/**
 * Creates a staff/salesman auth account + profile.
 *
 * Uses the service-role client's admin API (server-only — never
 * imported into client code, see lib/supabase/server.ts) rather than
 * supabase.auth.signUp(), because signUp() on the regular client
 * would replace the ADMIN's own session with the new account's
 * session. This is exactly the "Phase 2" use case that client was
 * already reserved for.
 *
 * Creating the auth user still fires the same handle_new_user() DB
 * trigger used by retailer registration (see
 * supabase/migrations/0002_auth_trigger.sql / 0012_...), so the
 * matching `profiles` row is created automatically from user_metadata
 * — no separate profiles insert needed here, and no risk of the two
 * ever drifting out of sync.
 */
export async function createStaffAction(_prevState: TeamFormState, formData: FormData): Promise<TeamFormState> {
  await requirePermission('team.manage');

  const parsed = staffSchema.safeParse({
    fullName: formData.get('fullName'),
    phone: formData.get('phone'),
    email: formData.get('email'),
    password: formData.get('password'),
    role: formData.get('role'),
    areaId: formData.get('areaId') || undefined,
    warehouseId: formData.get('warehouseId') || undefined,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid input.' };
  }
  const { fullName, phone, email, password, role, areaId, warehouseId } = parsed.data;

  // Same phone-uniqueness pre-check used by retailer registration —
  // profiles.phone is UNIQUE NOT NULL, and letting a duplicate reach
  // the handle_new_user() trigger would abort the whole auth.users
  // insert (see supabase/migrations/0012_fix_registration_phone_conflict.sql).
  const supabase = createClient();
  const { data: phoneTaken } = await supabase.rpc('is_phone_registered', { p_phone: phone });
  if (phoneTaken) {
    return { error: 'This phone number is already registered.' };
  }

  const adminClient = createServiceRoleClient();
  const { data: created, error: createError } = await adminClient.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { role, full_name: fullName, phone },
  });

  if (createError) {
    if (createError.message.toLowerCase().includes('already registered') || createError.message.toLowerCase().includes('already exists')) {
      return { error: 'An account with this email already exists.' };
    }
    return { error: createError.message };
  }
  if (!created.user) {
    return { error: 'Account creation failed unexpectedly.' };
  }

  if (areaId || warehouseId) {
    const payload: StaffAssignmentInsert = {
      staff_id: created.user.id,
      area_id: areaId || null,
      warehouse_id: warehouseId || null,
    };
    const { error: assignError } = await supabase.from('staff_assignments').insert(payload as unknown as never);
    // Don't fail the whole action over the assignment — the account
    // itself was created successfully and can be assigned later from
    // the edit screen.
    if (assignError) {
      revalidatePath('/admin/team');
      redirect('/admin/team');
    }
  }

  revalidatePath('/admin/team');
  redirect('/admin/team');
}

const staffEditSchema = z.object({
  fullName: z.string().min(2, 'Enter a full name.'),
  phone: z.string().regex(/^[6-9]\d{9}$/, 'Enter a valid 10-digit Indian mobile number.'),
  role: z.enum(['staff', 'salesman']),
  areaId: z.string().uuid().optional().or(z.literal('')),
  warehouseId: z.string().uuid().optional().or(z.literal('')),
});

export async function updateStaffAction(
  staffId: string,
  _prevState: TeamFormState,
  formData: FormData
): Promise<TeamFormState> {
  await requirePermission('team.manage');

  const parsed = staffEditSchema.safeParse({
    fullName: formData.get('fullName'),
    phone: formData.get('phone'),
    role: formData.get('role'),
    areaId: formData.get('areaId') || undefined,
    warehouseId: formData.get('warehouseId') || undefined,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid input.' };
  }
  const { fullName, phone, role, areaId, warehouseId } = parsed.data;

  const supabase = createClient();

  const payload: ProfileUpdate = { full_name: fullName, phone, role };
  const { error } = await supabase.from('profiles').update(payload as unknown as never).eq('id', staffId);
  if (error) {
    return { error: error.message.includes('duplicate') ? 'This phone number is already in use by another account.' : error.message };
  }

  // Replace any existing assignment with the submitted one (upsert by
  // delete-then-insert — staff_assignments has no unique constraint on
  // staff_id to upsert against, and a staff member has at most one
  // active assignment in the existing UI/workflow).
  await supabase.from('staff_assignments').delete().eq('staff_id', staffId);
  if (areaId || warehouseId) {
    const insertPayload: StaffAssignmentInsert = {
      staff_id: staffId,
      area_id: areaId || null,
      warehouse_id: warehouseId || null,
    };
    await supabase.from('staff_assignments').insert(insertPayload as unknown as never);
  }

  revalidatePath('/admin/team');
  redirect('/admin/team');
}

export async function toggleStaffActiveAction(staffId: string, isActive: boolean) {
  await requirePermission('team.manage');
  const supabase = createClient();
  const payload: ProfileUpdate = { is_active: isActive };
  const { error } = await supabase.from('profiles').update(payload as unknown as never).eq('id', staffId);
  if (error) throw new Error(error.message);
  revalidatePath('/admin/team');
}
