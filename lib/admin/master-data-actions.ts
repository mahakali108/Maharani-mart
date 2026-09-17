'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { requirePermission } from '@/lib/admin/guard';
import { deleteMedia, isRenderableMediaRef } from '@/lib/media';
import {
  categoryParentChainHits,
  findBrandNameDuplicate,
  findCategoryNameDuplicate,
} from '@/lib/admin/taxonomy-data';
import type { Database } from '@/types/database.types';

export type MasterDataFormState = { error?: string } | null;

/**
 * Optional media reference for `brands.logo_url` / `categories.image_url`.
 * Accepts a Supabase Storage public URL or a legacy absolute URL. An empty
 * string clears the column.
 */
const optionalMediaRefSchema = z
  .string()
  .optional()
  .or(z.literal(''))
  .refine((value) => {
    if (!value) return true;
    return isRenderableMediaRef(value);
  }, 'That image could not be attached. Upload it again.');

// ----------------------------------------------------------------------------
// Areas
// ----------------------------------------------------------------------------

const areaSchema = z.object({
  name: z.string().min(2, 'Enter an area name.'),
  district: z.string().min(2, 'Enter a district.'),
});

type AreaInsert = Database['public']['Tables']['areas']['Insert'];

export async function createAreaAction(
  _prevState: MasterDataFormState,
  formData: FormData
): Promise<MasterDataFormState> {
  await requirePermission('master_data.manage');

  const parsed = areaSchema.safeParse({
    name: formData.get('name'),
    district: formData.get('district'),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid input.' };
  }

  const supabase = createClient();
  const payload: AreaInsert = { name: parsed.data.name, district: parsed.data.district };
  const { error } = await supabase.from('areas').insert(payload as unknown as never);
  if (error) return { error: error.message.includes('duplicate') ? 'An area with this name already exists.' : error.message };

  revalidatePath('/admin/areas');
  return null;
}

export async function toggleAreaActiveAction(areaId: string, isActive: boolean) {
  await requirePermission('master_data.manage');
  const supabase = createClient();
  const { error } = await supabase.from('areas').update({ is_active: isActive } as unknown as never).eq('id', areaId);
  if (error) throw new Error(error.message);
  revalidatePath('/admin/areas');
}

export async function updateAreaAction(
  areaId: string,
  _prevState: MasterDataFormState,
  formData: FormData
): Promise<MasterDataFormState> {
  await requirePermission('master_data.manage');

  const parsed = areaSchema.safeParse({
    name: formData.get('name'),
    district: formData.get('district'),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid input.' };
  }

  const supabase = createClient();
  const payload: Partial<AreaInsert> = { name: parsed.data.name, district: parsed.data.district };
  const { error } = await supabase.from('areas').update(payload as unknown as never).eq('id', areaId);
  if (error) {
    return { error: error.message.includes('duplicate') ? 'An area with this name already exists.' : error.message };
  }

  revalidatePath('/admin/areas');
  redirect('/admin/areas');
}

export async function deleteAreaAction(areaId: string) {
  await requirePermission('master_data.manage');
  const supabase = createClient();
  const { error } = await supabase.from('areas').delete().eq('id', areaId);
  if (error) {
    if (error.message.includes('foreign key') || error.message.includes('violates')) {
      throw new Error('This area is in use (by a warehouse, retailer, or route) and cannot be deleted. Deactivate it instead.');
    }
    throw new Error(error.message);
  }
  revalidatePath('/admin/areas');
}

// ----------------------------------------------------------------------------
// Warehouses
// ----------------------------------------------------------------------------

const warehouseSchema = z.object({
  name: z.string().min(2, 'Enter a warehouse name.'),
  areaId: z.string().uuid().optional().or(z.literal('')),
  address: z.string().optional(),
});

type WarehouseInsert = Database['public']['Tables']['warehouses']['Insert'];

export async function createWarehouseAction(
  _prevState: MasterDataFormState,
  formData: FormData
): Promise<MasterDataFormState> {
  await requirePermission('inventory.manage');

  const parsed = warehouseSchema.safeParse({
    name: formData.get('name'),
    areaId: formData.get('areaId'),
    address: formData.get('address'),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid input.' };
  }

  const supabase = createClient();
  const payload: WarehouseInsert = {
    name: parsed.data.name,
    area_id: parsed.data.areaId || null,
    address: parsed.data.address || null,
  };
  const { error } = await supabase.from('warehouses').insert(payload as unknown as never);
  if (error) return { error: error.message };

  revalidatePath('/admin/warehouses');
  return null;
}

export async function toggleWarehouseActiveAction(warehouseId: string, isActive: boolean) {
  await requirePermission('inventory.manage');
  const supabase = createClient();
  const { error } = await supabase
    .from('warehouses')
    .update({ is_active: isActive } as unknown as never)
    .eq('id', warehouseId);
  if (error) throw new Error(error.message);
  revalidatePath('/admin/warehouses');
}

export async function updateWarehouseAction(
  warehouseId: string,
  _prevState: MasterDataFormState,
  formData: FormData
): Promise<MasterDataFormState> {
  await requirePermission('inventory.manage');

  const parsed = warehouseSchema.safeParse({
    name: formData.get('name'),
    areaId: formData.get('areaId'),
    address: formData.get('address'),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid input.' };
  }

  const supabase = createClient();
  const payload: Partial<WarehouseInsert> = {
    name: parsed.data.name,
    area_id: parsed.data.areaId || null,
    address: parsed.data.address || null,
  };
  const { error } = await supabase.from('warehouses').update(payload as unknown as never).eq('id', warehouseId);
  if (error) return { error: error.message };

  revalidatePath('/admin/warehouses');
  redirect('/admin/warehouses');
}

export async function deleteWarehouseAction(warehouseId: string) {
  await requirePermission('inventory.manage');
  const supabase = createClient();
  const { error } = await supabase.from('warehouses').delete().eq('id', warehouseId);
  if (error) {
    if (error.message.includes('foreign key') || error.message.includes('violates')) {
      throw new Error('This warehouse has inventory or orders linked to it and cannot be deleted. Deactivate it instead.');
    }
    throw new Error(error.message);
  }
  revalidatePath('/admin/warehouses');
}

// ----------------------------------------------------------------------------
// Brands
// ----------------------------------------------------------------------------

const brandSchema = z.object({
  name: z.string().trim().min(2, 'Enter a brand name.'),
  logoUrl: optionalMediaRefSchema,
});

type BrandInsert = Database['public']['Tables']['brands']['Insert'];

export async function createBrandAction(
  _prevState: MasterDataFormState,
  formData: FormData
): Promise<MasterDataFormState> {
  await requirePermission('master_data.manage');

  const parsed = brandSchema.safeParse({
    name: formData.get('name'),
    logoUrl: formData.get('logoUrl') ?? '',
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid input.' };
  }

  const supabase = createClient();

  // Case-insensitive duplicate pre-check. `brands.name` has only a
  // case-sensitive unique constraint (0001), so "Tata" and "tata" would
  // otherwise coexist. The constraint remains the backstop for races.
  const duplicate = await findBrandNameDuplicate(supabase, parsed.data.name);
  if (duplicate) {
    return { error: `A brand with this name already exists (“${duplicate.name}”).` };
  }

  const payload: BrandInsert = { name: parsed.data.name, logo_url: parsed.data.logoUrl || null };
  const { error } = await supabase.from('brands').insert(payload as unknown as never);
  if (error) return { error: error.message.includes('duplicate') ? 'A brand with this name already exists.' : error.message };

  revalidatePath('/admin/catalog');
  revalidatePath('/admin/catalog/brands');
  return null;
}

export async function toggleBrandActiveAction(brandId: string, isActive: boolean) {
  await requirePermission('master_data.manage');
  const supabase = createClient();
  const { error } = await supabase.from('brands').update({ is_active: isActive } as unknown as never).eq('id', brandId);
  if (error) throw new Error(error.message);
  revalidatePath('/admin/catalog');
  revalidatePath('/admin/catalog/brands');
}

export async function updateBrandAction(
  brandId: string,
  _prevState: MasterDataFormState,
  formData: FormData
): Promise<MasterDataFormState> {
  await requirePermission('master_data.manage');

  const parsed = brandSchema.safeParse({
    name: formData.get('name'),
    logoUrl: formData.get('logoUrl') ?? '',
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid input.' };
  }

  const supabase = createClient();

  // Same duplicate rule as create, ignoring the brand's own current name.
  const duplicate = await findBrandNameDuplicate(supabase, parsed.data.name, brandId);
  if (duplicate) {
    return { error: `A brand with this name already exists (“${duplicate.name}”).` };
  }

  // If the logo was replaced, remember the previous reference so the old
  // file can be cleaned up after the row update succeeds.
  const { data: existing } = await supabase
    .from('brands')
    .select('logo_url')
    .eq('id', brandId)
    .maybeSingle<{ logo_url: string | null }>();

  const payload: Partial<BrandInsert> = {
    name: parsed.data.name,
    logo_url: parsed.data.logoUrl || null,
  };
  const { error } = await supabase.from('brands').update(payload as unknown as never).eq('id', brandId);
  if (error) {
    return { error: error.message.includes('duplicate') ? 'A brand with this name already exists.' : error.message };
  }

  if (existing?.logo_url && existing.logo_url !== payload.logo_url) {
    await deleteMedia(existing.logo_url);
  }

  revalidatePath('/admin/catalog');
  revalidatePath('/admin/catalog/brands');
  redirect('/admin/catalog/brands');
}

export async function deleteBrandAction(brandId: string) {
  await requirePermission('master_data.manage');
  const supabase = createClient();

  const { data, error } = await supabase
    .from('brands')
    .delete()
    .eq('id', brandId)
    .select('logo_url')
    .maybeSingle<{ logo_url: string | null }>();
  if (error) {
    if (error.message.includes('foreign key') || error.message.includes('violates')) {
      throw new Error('This brand is assigned to one or more products and cannot be deleted. Deactivate it instead.');
    }
    throw new Error(error.message);
  }

  if (data?.logo_url) await deleteMedia(data.logo_url);

  revalidatePath('/admin/catalog');
  revalidatePath('/admin/catalog/brands');
}

// ----------------------------------------------------------------------------
// Categories
// ----------------------------------------------------------------------------

const categorySchema = z.object({
  name: z.string().trim().min(2, 'Enter a category name.'),
  parentId: z.string().uuid().optional().or(z.literal('')),
  imageUrl: optionalMediaRefSchema,
});

type CategoryInsert = Database['public']['Tables']['categories']['Insert'];

/** Postgres unique/FK violation text → an operator-readable message. */
function categoryWriteError(error: { message: string }): string {
  if (error.message.includes('duplicate')) {
    return 'This category already exists under the selected parent.';
  }
  if (error.message.includes('foreign key') || error.message.includes('violates')) {
    return 'The selected parent category no longer exists.';
  }
  return error.message;
}

export async function createCategoryAction(
  _prevState: MasterDataFormState,
  formData: FormData
): Promise<MasterDataFormState> {
  await requirePermission('master_data.manage');

  const parsed = categorySchema.safeParse({
    name: formData.get('name'),
    parentId: formData.get('parentId'),
    imageUrl: formData.get('imageUrl') ?? '',
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid input.' };
  }

  const supabase = createClient();
  const parentId = parsed.data.parentId || null;

  // Pre-check mirrors categories_name_parent_ci_uq (0027): same parent,
  // case-insensitive name. The index remains the backstop for races.
  const duplicate = await findCategoryNameDuplicate(supabase, parsed.data.name, parentId);
  if (duplicate) {
    return { error: `This category already exists under the selected parent (“${duplicate.name}”).` };
  }

  const payload: CategoryInsert = {
    name: parsed.data.name,
    parent_id: parentId,
    image_url: parsed.data.imageUrl || null,
  };
  const { error } = await supabase.from('categories').insert(payload as unknown as never);
  if (error) return { error: categoryWriteError(error) };

  revalidatePath('/admin/catalog');
  revalidatePath('/admin/catalog/categories');
  return null;
}

export async function toggleCategoryActiveAction(categoryId: string, isActive: boolean) {
  await requirePermission('master_data.manage');
  const supabase = createClient();
  const { error } = await supabase
    .from('categories')
    .update({ is_active: isActive } as unknown as never)
    .eq('id', categoryId);
  if (error) throw new Error(error.message);
  revalidatePath('/admin/catalog');
  revalidatePath('/admin/catalog/categories');
}

export async function updateCategoryAction(
  categoryId: string,
  _prevState: MasterDataFormState,
  formData: FormData
): Promise<MasterDataFormState> {
  await requirePermission('master_data.manage');

  const parsed = categorySchema.safeParse({
    name: formData.get('name'),
    parentId: formData.get('parentId'),
    imageUrl: formData.get('imageUrl') ?? '',
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid input.' };
  }
  if (parsed.data.parentId === categoryId) {
    return { error: 'A category cannot be its own parent.' };
  }

  const supabase = createClient();
  const parentId = parsed.data.parentId || null;

  // Same duplicate rule as create, ignoring the category's own current name.
  const duplicate = await findCategoryNameDuplicate(supabase, parsed.data.name, parentId, categoryId);
  if (duplicate) {
    return { error: `This category already exists under the selected parent (“${duplicate.name}”).` };
  }

  // A parent must not be the category itself or any of its descendants,
  // otherwise A → B → A silently disappears from the retailer directory
  // (which renders top-level categories and their children).
  if (parentId && (await categoryParentChainHits(supabase, categoryId, parentId))) {
    return { error: 'That parent would create a circular category chain. Pick a top-level category instead.' };
  }

  const { data: existing } = await supabase
    .from('categories')
    .select('image_url')
    .eq('id', categoryId)
    .maybeSingle<{ image_url: string | null }>();

  const payload: Partial<CategoryInsert> = {
    name: parsed.data.name,
    parent_id: parentId,
    image_url: parsed.data.imageUrl || null,
  };
  const { error } = await supabase.from('categories').update(payload as unknown as never).eq('id', categoryId);
  if (error) {
    return { error: categoryWriteError(error) };
  }

  if (existing?.image_url && existing.image_url !== payload.image_url) {
    await deleteMedia(existing.image_url);
  }

  revalidatePath('/admin/catalog');
  revalidatePath('/admin/catalog/categories');
  redirect('/admin/catalog/categories');
}

export async function deleteCategoryAction(categoryId: string) {
  await requirePermission('master_data.manage');
  const supabase = createClient();

  const { data, error } = await supabase
    .from('categories')
    .delete()
    .eq('id', categoryId)
    .select('image_url')
    .maybeSingle<{ image_url: string | null }>();
  if (error) {
    if (error.message.includes('foreign key') || error.message.includes('violates')) {
      throw new Error('This category has products or subcategories linked to it and cannot be deleted. Deactivate it instead.');
    }
    throw new Error(error.message);
  }

  if (data?.image_url) await deleteMedia(data.image_url);

  revalidatePath('/admin/catalog');
  revalidatePath('/admin/catalog/categories');
}
