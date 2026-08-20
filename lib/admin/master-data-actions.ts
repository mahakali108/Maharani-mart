'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { requirePermission } from '@/lib/admin/guard';
import { deleteMedia, parseMediaRef } from '@/lib/media';
import type { Database } from '@/types/database.types';

export type MasterDataFormState = { error?: string } | null;

/**
 * Optional media reference for `brands.logo_url` / `categories.image_url`.
 * Accepts an Appwrite reference (`appwrite://<bucket>/<id>`) or a legacy
 * absolute URL, so values written before the Appwrite rollout still validate.
 * An empty string clears the column.
 */
const optionalMediaRefSchema = z
  .string()
  .optional()
  .or(z.literal(''))
  .refine((value) => {
    if (!value) return true;
    const ref = parseMediaRef(value);
    if (!ref) return false;
    return ref.provider === 'appwrite' || /^https?:\/\//i.test(ref.value);
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
  name: z.string().min(2, 'Enter a brand name.'),
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
  const payload: BrandInsert = { name: parsed.data.name, logo_url: parsed.data.logoUrl || null };
  const { error } = await supabase.from('brands').insert(payload as unknown as never);
  if (error) return { error: error.message.includes('duplicate') ? 'A brand with this name already exists.' : error.message };

  revalidatePath('/admin/catalog');
  return null;
}

export async function toggleBrandActiveAction(brandId: string, isActive: boolean) {
  await requirePermission('master_data.manage');
  const supabase = createClient();
  const { error } = await supabase.from('brands').update({ is_active: isActive } as unknown as never).eq('id', brandId);
  if (error) throw new Error(error.message);
  revalidatePath('/admin/catalog');
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

  // If the logo was replaced, remember the previous reference so the old
  // Appwrite file can be cleaned up after the row update succeeds.
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
  redirect('/admin/catalog');
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
}

// ----------------------------------------------------------------------------
// Categories
// ----------------------------------------------------------------------------

const categorySchema = z.object({
  name: z.string().min(2, 'Enter a category name.'),
  parentId: z.string().uuid().optional().or(z.literal('')),
  imageUrl: optionalMediaRefSchema,
});

type CategoryInsert = Database['public']['Tables']['categories']['Insert'];

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
  const payload: CategoryInsert = {
    name: parsed.data.name,
    parent_id: parsed.data.parentId || null,
    image_url: parsed.data.imageUrl || null,
  };
  const { error } = await supabase.from('categories').insert(payload as unknown as never);
  if (error) return { error: error.message.includes('duplicate') ? 'This category already exists under the selected parent.' : error.message };

  revalidatePath('/admin/catalog');
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

  const { data: existing } = await supabase
    .from('categories')
    .select('image_url')
    .eq('id', categoryId)
    .maybeSingle<{ image_url: string | null }>();

  const payload: Partial<CategoryInsert> = {
    name: parsed.data.name,
    parent_id: parsed.data.parentId || null,
    image_url: parsed.data.imageUrl || null,
  };
  const { error } = await supabase.from('categories').update(payload as unknown as never).eq('id', categoryId);
  if (error) {
    return {
      error: error.message.includes('duplicate') ? 'This category already exists under the selected parent.' : error.message,
    };
  }

  if (existing?.image_url && existing.image_url !== payload.image_url) {
    await deleteMedia(existing.image_url);
  }

  revalidatePath('/admin/catalog');
  redirect('/admin/catalog');
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
}
