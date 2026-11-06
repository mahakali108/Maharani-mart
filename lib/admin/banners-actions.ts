'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { requirePermission } from '@/lib/admin/guard';
import { deleteMedia, isRenderableMediaRef } from '@/lib/media';
import { bannerScheduleInstants, resolveBannerTarget } from '@/lib/retailer/banner-target';
import type { Database } from '@/types/database.types';

export type BannerFormState = { error?: string } | null;

type BannerInsert = Database['public']['Tables']['banners']['Insert'];
type BannerUpdate = Database['public']['Tables']['banners']['Update'];

/**
 * `image_url` holds a Supabase Storage public URL (produced by lib/media), or
 * a legacy absolute URL from before the storage layer was normalised. Both
 * are accepted so existing banners can be edited without re-uploading.
 */
const mediaRefSchema = z
  .string()
  .min(1, 'Upload an image first.')
  .refine((value) => isRenderableMediaRef(value), 'Upload an image first.');

/** The mobile rendition is optional: an empty value means "reuse the desktop art". */
const optionalMediaRefSchema = z
  .string()
  .trim()
  .optional()
  .refine((value) => !value || isRenderableMediaRef(value), 'Upload a valid mobile image.');

const bannerStatusSchema = z.enum(['draft', 'published'], {
  errorMap: () => ({ message: 'Choose draft or published.' }),
});

const bannerSchema = z.object({
  title: z.string().trim().min(2, 'Enter a title.').max(140, 'Keep the title under 140 characters.'),
  imageUrl: mediaRefSchema,
  imageUrlMobile: optionalMediaRefSchema,
  status: bannerStatusSchema,
  subtitle: z.string().trim().max(300, 'Keep the subtitle under 300 characters.').optional(),
  ctaLabel: z.string().trim().max(60, 'Keep the button label under 60 characters.').optional(),
  linkUrl: z.string().trim().refine((value) => !value || !!resolveBannerTarget(value), 'Use an app route or an http(s) URL.').optional(),
  areaId: z.string().uuid().optional().or(z.literal('')),
  sortOrder: z.coerce.number().int().min(0, 'Priority must be zero or higher.').max(1000000, 'Priority is too large.'),
  startsAt: z.string().optional().or(z.literal('')),
  endsAt: z.string().optional().or(z.literal('')),
}).superRefine((data, context) => {
  const schedule = bannerScheduleInstants(data.startsAt, data.endsAt);
  if (data.startsAt && !schedule.startsAt) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['startsAt'], message: 'Choose a valid start date and time.' });
  }
  if (data.endsAt && !schedule.endsAt) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['endsAt'], message: 'Choose a valid end date and time.' });
  }
  if (schedule.startsAt && schedule.endsAt && Date.parse(schedule.endsAt) <= Date.parse(schedule.startsAt)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['endsAt'], message: 'The end must be after the start.' });
  }
});

export async function createBannerAction(_prevState: BannerFormState, formData: FormData): Promise<BannerFormState> {
  const user = await requirePermission('banners.manage');

  const parsed = bannerSchema.safeParse({
    title: formData.get('title'),
    imageUrl: formData.get('imageUrl'),
    imageUrlMobile: formData.get('imageUrlMobile') || undefined,
    status: formData.get('status') || 'draft',
    subtitle: formData.get('subtitle') || undefined,
    ctaLabel: formData.get('ctaLabel') || undefined,
    linkUrl: formData.get('linkUrl') || undefined,
    areaId: formData.get('areaId') || undefined,
    sortOrder: formData.get('sortOrder'),
    startsAt: formData.get('startsAt') || undefined,
    endsAt: formData.get('endsAt') || undefined,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid input.' };
  }
  const { title, subtitle, ctaLabel, imageUrl, imageUrlMobile, status, linkUrl, areaId, sortOrder, startsAt, endsAt } = parsed.data;

  const supabase = (await createClient());

  const payload: BannerInsert = {
    title,
    image_url: imageUrl,
    image_url_mobile: imageUrlMobile || null,
    status,
    subtitle: subtitle || null,
    cta_label: ctaLabel || null,
    link_url: linkUrl || null,
    area_id: areaId || null,
    sort_order: sortOrder,
    ...(() => {
      const schedule = bannerScheduleInstants(startsAt, endsAt);
      return { starts_at: schedule.startsAt, ends_at: schedule.endsAt };
    })(),
    created_by: user.id,
  };

  const { error } = await supabase.from('banners').insert(payload as unknown as never);
  if (error) return { error: error.message };

  revalidatePath('/admin/banners');
  revalidatePath('/retailer/home');
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
    imageUrlMobile: formData.get('imageUrlMobile') || undefined,
    status: formData.get('status') || 'draft',
    subtitle: formData.get('subtitle') || undefined,
    ctaLabel: formData.get('ctaLabel') || undefined,
    linkUrl: formData.get('linkUrl') || undefined,
    areaId: formData.get('areaId') || undefined,
    sortOrder: formData.get('sortOrder'),
    startsAt: formData.get('startsAt') || undefined,
    endsAt: formData.get('endsAt') || undefined,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid input.' };
  }
  const { title, subtitle, ctaLabel, imageUrl, imageUrlMobile, status, linkUrl, areaId, sortOrder, startsAt, endsAt } = parsed.data;

  const supabase = (await createClient());
  const schedule = bannerScheduleInstants(startsAt, endsAt);
  const payload: BannerUpdate = {
    title,
    image_url: imageUrl,
    image_url_mobile: imageUrlMobile || null,
    status,
    subtitle: subtitle || null,
    cta_label: ctaLabel || null,
    link_url: linkUrl || null,
    area_id: areaId || null,
    sort_order: sortOrder,
    starts_at: schedule.startsAt,
    ends_at: schedule.endsAt,
  };

  const { error } = await supabase.from('banners').update(payload as unknown as never).eq('id', bannerId);
  if (error) return { error: error.message };

  revalidatePath('/admin/banners');
  revalidatePath('/retailer/home');
  redirect('/admin/banners');
}

/**
 * Publish a draft, or move a live banner back to draft. Drafts are hidden from
 * every non-staff reader by the 0074 SELECT policy, regardless of is_active.
 */
export async function setBannerStatusAction(bannerId: string, status: 'draft' | 'published') {
  const parsed = bannerStatusSchema.safeParse(status);
  if (!parsed.success) throw new Error('Choose draft or published.');
  await requirePermission('banners.manage');
  const supabase = (await createClient());
  const payload: BannerUpdate = { status: parsed.data };
  const { error } = await supabase.from('banners').update(payload as unknown as never).eq('id', bannerId);
  if (error) throw new Error(error.message);
  revalidatePath('/admin/banners');
  revalidatePath('/retailer/home');
}

export async function toggleBannerActiveAction(bannerId: string, isActive: boolean) {
  await requirePermission('banners.manage');
  const supabase = (await createClient());
  const payload: BannerUpdate = { is_active: isActive };
  const { error } = await supabase.from('banners').update(payload as unknown as never).eq('id', bannerId);
  if (error) throw new Error(error.message);
  revalidatePath('/admin/banners');
  revalidatePath('/retailer/home');
}

export async function reorderBannerAction(bannerId: string, direction: 'up' | 'down') {
  await requirePermission('banners.manage');
  const supabase = (await createClient());

  const { data } = await supabase.from('banners').select('id, sort_order').order('sort_order').order('id');
  const rows = (data ?? []) as unknown as { id: string; sort_order: number }[];
  const index = rows.findIndex((r) => r.id === bannerId);
  if (index === -1) return;

  const swapIndex = direction === 'up' ? index - 1 : index + 1;
  if (swapIndex < 0 || swapIndex >= rows.length) return;
  const reordered = [...rows];
  [reordered[index], reordered[swapIndex]] = [reordered[swapIndex]!, reordered[index]!];

  // Normalize to stable 10-point priority increments so moving banners also
  // works when two rows previously had the same manually-entered priority.
  await Promise.all(reordered.map((row, position) =>
    supabase.from('banners').update({ sort_order: position * 10 } as unknown as never).eq('id', row!.id)
  ));

  revalidatePath('/admin/banners');
  revalidatePath('/retailer/home');
}

export async function deleteBannerAction(bannerId: string) {
  await requirePermission('banners.manage');
  const supabase = (await createClient());

  const { data, error } = await supabase
    .from('banners')
    .delete()
    .eq('id', bannerId)
    .select('image_url, image_url_mobile')
    .single<{ image_url: string; image_url_mobile: string | null }>();
  if (error) throw new Error(error.message);

  // Also remove the underlying files so deleting a banner doesn't leave them
  // orphaned. deleteMedia() is best-effort and only removes Supabase objects
  // it can confidently identify; legacy files are never auto-deleted en masse.
  if (data) {
    const refs = new Set([data.image_url, data.image_url_mobile].filter((ref): ref is string => !!ref));
    await Promise.all([...refs].map((ref) => deleteMedia(ref)));
  }

  revalidatePath('/admin/banners');
  revalidatePath('/retailer/home');
}
