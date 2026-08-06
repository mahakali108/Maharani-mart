'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { requirePermission } from '@/lib/admin/guard';
import type { Database } from '@/types/database.types';

type RetailerUpdate = Database['public']['Tables']['retailers']['Update'];

export async function approveRetailerAction(retailerId: string) {
  const user = await requirePermission('retailers.approve');
  const supabase = createClient();

  const payload: RetailerUpdate = {
    status: 'active',
    approved_by: user.id,
    approved_at: new Date().toISOString(),
  };

  const { error } = await supabase.from('retailers').update(payload as unknown as never).eq('id', retailerId);
  if (error) throw new Error(error.message);

  revalidatePath('/admin/retailers');
}

export async function suspendRetailerAction(retailerId: string) {
  await requirePermission('retailers.suspend');
  const supabase = createClient();

  const payload: RetailerUpdate = { status: 'suspended' };
  const { error } = await supabase.from('retailers').update(payload as unknown as never).eq('id', retailerId);
  if (error) throw new Error(error.message);

  revalidatePath('/admin/retailers');
}

/**
 * Rejects a pending registration. Deliberately does NOT delete the
 * `retailers` row (which would orphan the linked `profiles`/auth user
 * with no retailer record — middleware's pending-approval check
 * assumes a retailer row exists for role='retailer', so a missing row
 * would silently skip that gate rather than block access). Using the
 * same 'suspended' status as suspendRetailerAction keeps that
 * invariant safe while still being a distinct, auditable action.
 */
export async function rejectRetailerAction(retailerId: string) {
  await requirePermission('retailers.suspend');
  const supabase = createClient();

  const payload: RetailerUpdate = { status: 'suspended' };
  const { error } = await supabase.from('retailers').update(payload as unknown as never).eq('id', retailerId);
  if (error) throw new Error(error.message);

  revalidatePath('/admin/retailers');
}

export async function reactivateRetailerAction(retailerId: string) {
  await requirePermission('retailers.approve');
  const supabase = createClient();

  const payload: RetailerUpdate = { status: 'active' };
  const { error } = await supabase.from('retailers').update(payload as unknown as never).eq('id', retailerId);
  if (error) throw new Error(error.message);

  revalidatePath('/admin/retailers');
}

export type RetailerFormState = { error?: string } | null;

export async function reassignRetailerAreaAction(
  retailerId: string,
  _prevState: RetailerFormState,
  formData: FormData
): Promise<RetailerFormState> {
  await requirePermission('retailers.approve');

  const areaId = formData.get('areaId');
  if (typeof areaId !== 'string' || areaId.length === 0) {
    return { error: 'Select an area.' };
  }

  const supabase = createClient();
  const payload: RetailerUpdate = { area_id: areaId };
  const { error } = await supabase.from('retailers').update(payload as unknown as never).eq('id', retailerId);
  if (error) return { error: error.message };

  revalidatePath('/admin/retailers');
  revalidatePath(`/admin/retailers/${retailerId}`);
  return null;
}

type RetailerDocumentInsert = Database['public']['Tables']['retailer_documents']['Insert'];

export async function addRetailerDocumentAction(
  retailerId: string,
  docType: string,
  fileUrl: string,
  fileName: string
) {
  const user = await requirePermission('retailers.approve');
  const supabase = createClient();

  const payload: RetailerDocumentInsert = {
    retailer_id: retailerId,
    doc_type: docType,
    file_url: fileUrl,
    file_name: fileName,
    uploaded_by: user.id,
  };

  const { error } = await supabase.from('retailer_documents').insert(payload as unknown as never);
  if (error) throw new Error(error.message);

  revalidatePath(`/admin/retailers/${retailerId}`);
}

export async function deleteRetailerDocumentAction(documentId: string, retailerId: string) {
  await requirePermission('retailers.approve');
  const supabase = createClient();

  const { error } = await supabase.from('retailer_documents').delete().eq('id', documentId);
  if (error) throw new Error(error.message);

  revalidatePath(`/admin/retailers/${retailerId}`);
}
