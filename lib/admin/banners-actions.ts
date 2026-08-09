'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { requirePermission } from '@/lib/admin/guard';
import type { Database } from '@/types/database.types';

export type BannerFormState = { error?: string } | null;

type BannerInsert = Database['public']['Tables']['banners']['Insert'];
type BannerUpdate = Database['public']['Tables']['banners']['Update'];

const bannerSchema = z.object({
  title: z.string().min(2, 'Enter a title.'),
  imageUrl: z.string().url('Upload an image first.'),
  linkUrl: z.string().url().optional().or(z.literal('')),
  areaId: z.string().uuid().optional().or(z.literal('')),
  startsAt: z.string().optional().or(z.literal('')),
  endsAt: z.string().optional().or(z.literal('')),
});

export async function createBannerAction(_prevState: BannerFormState, formData: FormData): Promise<BannerFormState> {
  const user = await requirePermission('banners.manage');

  const parsed = bannerSchema.safeParse({
    title: formData.get('title'),
    imageUrl: formData.get('imageUrl'),
    linkUrl: formData.get('linkUrl') || undefined,
    areaId: formData.get('areaId') || undefined,
    startsAt: formData.get('startsAt') || undefined,
    endsAt: formData.get('endsAt') || undefined,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid input.' };
  }
  const { title, imageUrl, linkUrl, areaId, startsAt, endsAt } = parsed.data;

  const supabase = createClient();

  // New banners go to the end of the sort order within their scope.
  const { count } = await supabase.from('banners').select('id', { count: 'exact', head: true });

  const payload: BannerInsert = {
    title,
    image_url: imageUrl,
    link_url: linkUrl || null,
    area_id: areaId || null,
    sort_order: count ?? 0,
    starts_at: startsAt ? new Date(startsAt).toISOString() : null,
    ends_at: endsAt ? new Date(endsAt).toISOString() : null,
    created_by: user.id,
  };

  const { error } = await supabase.from('banners').insert(payload as unknown as never);
  if (error) return { error: error.message };

  revalidatePath('/admin/banners');
  redirect('/admin/banners');
}

export async function updateBannerAction(
  bannerId: string,
  _prevState: BannerFormState,
  formData: FormData
): Promise<BannerFormState> {
  await requirePermission('banners.manage');

  const parsed = bannerSchema.safeParse({
    title: formData.get('title'),
    imageUrl: formData.get('imageUrl'),
    linkUrl: formData.get('linkUrl') || undefined,
    areaId: formData.get('areaId') || undefined,
    startsAt: formData.get('startsAt') || undefined,
    endsAt: formData.get('endsAt') || undefined,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid input.' };
  }
  const { title, imageUrl, linkUrl, areaId, startsAt, endsAt } = parsed.data;

  const supabase = createClient();
  const payload: BannerUpdate = {
    title,
    image_url: imageUrl,
    link_url: linkUrl || null,
    area_id: areaId || null,
    starts_at: startsAt ? new Date(startsAt).toISOString() : null,
    ends_at: endsAt ? new Date(endsAt).toISOString() : null,
  };

  const { error } = await supabase.from('banners').update(payload as unknown as never).eq('id', bannerId);
  if (error) return { error: error.message };

  revalidatePath('/admin/banners');
  redirect('/admin/banners');
}

export async function toggleBannerActiveAction(bannerId: string, isActive: boolean) {
  await requirePermission('banners.manage');
  const supabase = createClient();
  const payload: BannerUpdate = { is_active: isActive };
  const { error } = await supabase.from('banners').update(payload as unknown as never).eq('id', bannerId);
  if (error) throw new Error(error.message);
  revalidatePath('/admin/banners');
}

export async function reorderBannerAction(bannerId: string, direction: 'up' | 'down') {
  await requirePermission('banners.manage');
  const supabase = createClient();

  const { data } = await supabase.from('banners').select('id, sort_order').order('sort_order');
  const rows = (data ?? []) as unknown as { id: string; sort_order: number }[];
  const index = rows.findIndex((r) => r.id === bannerId);
  if (index === -1) return;

  const swapIndex = direction === 'up' ? index - 1 : index + 1;
  if (swapIndex < 0 || swapIndex >= rows.length) return;

  const a = rows[index];
  const b = rows[swapIndex];
  // With `noUncheckedIndexedAccess` enabled, TypeScript can't infer
  // from the bounds check above that these are defined — the check
  // guards the *numeric* indices, not the array-access expressions
  // themselves. This guard makes that guarantee explicit for the
  // compiler (same pattern as swapSortOrder in products-actions.ts).
  if (!a || !b) return;

  await Promise.all([
    supabase.from('banners').update({ sort_order: b.sort_order } as unknown as never).eq('id', a.id),
    supabase.from('banners').update({ sort_order: a.sort_order } as unknown as never).eq('id', b.id),
  ]);

  revalidatePath('/admin/banners');
}

export async function deleteBannerAction(bannerId: string) {
  await requirePermission('banners.manage');
  const supabase = createClient();

  const { data, error } = await supabase
    .from('banners')
    .delete()
    .eq('id', bannerId)
    .select('image_url')
    .single<{ image_url: string }>();
  if (error) throw new Error(error.message);

  // Same reasoning as products-actions.ts's removeProductImageAction:
  // also remove the underlying file so deleting a banner doesn't leave
  // it orphaned in the public banners bucket. image_url is the full
  // public URL returned by lib/storage/upload.ts's getPublicUrl().
  const marker = '/banners/';
  const markerIndex = data?.image_url.indexOf(marker) ?? -1;
  if (markerIndex !== -1 && data) {
    const path = data.image_url.slice(markerIndex + marker.length);
    await supabase.storage.from('banners').remove([path]);
  }

  revalidatePath('/admin/banners');
}
