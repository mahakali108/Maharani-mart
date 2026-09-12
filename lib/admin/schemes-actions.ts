'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { requirePermission } from '@/lib/admin/guard';
import type { Database } from '@/types/database.types';

export type SchemeActionResult = { error?: string } | { success: true };

type SchemeInsert = Database['public']['Tables']['schemes']['Insert'];

const schemeSchema = z
  .object({
    name: z.string().trim().min(3, 'Give the scheme a name (at least 3 characters).').max(120),
    description: z.string().trim().max(1000).optional(),
    isFestival: z.boolean().default(false),
    startsAt: z.string().min(1, 'Choose a start date and time.'),
    endsAt: z.string().min(1, 'Choose an end date and time.'),
  })
  .refine((data) => new Date(data.endsAt).getTime() > new Date(data.startsAt).getTime(), {
    message: 'The scheme must end after it starts.',
  });

function parseStartsAt(value: string): Date | null {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * Creates a scheme. The `schemes` table and its RLS have existed since
 * 0001/0013 — this is the first write path. Every change is audited by
 * trg_audit_schemes (migration 0040).
 */
export async function createSchemeAction(input: z.input<typeof schemeSchema>): Promise<SchemeActionResult> {
  const user = await requirePermission('pricing.manage');

  const parsed = schemeSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Check the scheme details.' };

  const startsAt = parseStartsAt(parsed.data.startsAt);
  const endsAt = parseStartsAt(parsed.data.endsAt);
  if (!startsAt || !endsAt) return { error: 'Choose valid start and end date/times.' };

  const supabase = createClient();
  const payload: SchemeInsert = {
    name: parsed.data.name,
    description: parsed.data.description || null,
    is_festival: parsed.data.isFestival,
    starts_at: startsAt.toISOString(),
    ends_at: endsAt.toISOString(),
    is_active: true,
    created_by: user.id,
  };

  const { error } = await supabase.from('schemes').insert(payload as unknown as never);
  if (error) return { error: error.message };

  revalidatePath('/admin/pricing/schemes');
  revalidatePath('/retailer/schemes');
  return { success: true };
}

export async function updateSchemeAction(
  schemeId: string,
  input: z.input<typeof schemeSchema>
): Promise<SchemeActionResult> {
  await requirePermission('pricing.manage');
  if (!schemeId) return { error: 'Scheme not found.' };

  const parsed = schemeSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Check the scheme details.' };

  const startsAt = parseStartsAt(parsed.data.startsAt);
  const endsAt = parseStartsAt(parsed.data.endsAt);
  if (!startsAt || !endsAt) return { error: 'Choose valid start and end date/times.' };

  const supabase = createClient();
  const { error } = await supabase
    .from('schemes')
    .update({
      name: parsed.data.name,
      description: parsed.data.description || null,
      is_festival: parsed.data.isFestival,
      starts_at: startsAt.toISOString(),
      ends_at: endsAt.toISOString(),
    } as unknown as never)
    .eq('id', schemeId);

  if (error) return { error: error.message };

  revalidatePath('/admin/pricing/schemes');
  revalidatePath('/retailer/schemes');
  return { success: true };
}

/** Toggles a scheme on/off. Deactivation keeps the row for history. */
export async function toggleSchemeAction(schemeId: string, isActive: boolean): Promise<SchemeActionResult> {
  await requirePermission('pricing.manage');
  if (!schemeId) return { error: 'Scheme not found.' };

  const supabase = createClient();
  const { error } = await supabase
    .from('schemes')
    .update({ is_active: isActive } as unknown as never)
    .eq('id', schemeId);

  if (error) return { error: error.message };

  revalidatePath('/admin/pricing/schemes');
  revalidatePath('/retailer/schemes');
  return { success: true };
}
