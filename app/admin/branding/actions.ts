'use server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { requireSuperAdmin } from '@/lib/admin/control-center/guard';
import { createClient } from '@/lib/supabase/server';

export async function recordBrand(form: FormData) {
  await requireSuperAdmin();
  const source = form.get('revision');
  const args = source === null ? {
    p_name: z.string().trim().min(1).max(64).parse(form.get('name')),
    p_tagline: z.string().trim().min(1).max(140).parse(form.get('tagline')), p_source: null,
  } : { p_name: '', p_tagline: '', p_source: z.coerce.number().int().positive().safe().parse(source) };
  const expected = form.get('expected');
  const p_expected = expected ? z.coerce.number().int().positive().safe().parse(expected) : null;
  let uncertain = false;
  try {
    const { error } = await (await createClient()).rpc('record_storefront_brand', { ...args, p_expected } as never);
    uncertain = !!error;
  } catch {
    uncertain = true;
  }
  revalidatePath('/admin/branding');
  revalidatePath('/retailer/home');
  redirect(uncertain ? '/admin/branding?verify=1' : '/admin/branding');
}
