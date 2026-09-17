'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { requirePermission } from '@/lib/admin/guard';
import { deleteMedia, isRenderableMediaRef } from '@/lib/media';
import {
  BRANDS_LIST_PATH,
  CATEGORIES_LIST_PATH,
  duplicateNameError,
  normalizeMasterName,
  parseSortOrder,
  validateBrandName,
  validateCategoryName,
} from '@/lib/admin/master-data-query';
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
// Shared brand/category helpers (Phase 7)
// ----------------------------------------------------------------------------

type MasterSupabaseClient = ReturnType<typeof createClient>;

/** Escape LIKE wildcards so an `ilike` pre-check matches the literal name only. */
function escapeLikePattern(value: string): string {
  return value.replace(/([%_\\])/g, '\\$1');
}

/**
 * Case-insensitive "does this name already exist" pre-flight for brands and
 * categories.
 *
 * The database is the real guarantee — `categories` via the case-insensitive
 * index `categories_name_parent_ci_uq` (0027), `brands` via the exact
 * `unique(name)` constraint — so a race here is still caught on write. The
 * pre-flight exists to catch "tata" beside "Tata" for brands (where the DB
 * constraint is case-sensitive) and to return the operator a sentence instead
 * of a raw Postgres error.
 */
async function masterNameExists(
  supabase: MasterSupabaseClient,
  table: 'brands' | 'categories',
  name: string,
  options: { parentId?: string | null; excludeId?: string } = {}
): Promise<boolean> {
  const pattern = escapeLikePattern(name);
  // count=exact is computed over the filtered set regardless of limit, and
  // limit(1) keeps the payload at one id row — the boolean comes from `count`.
  // `.eq()` cannot express `parent_id IS NULL` in the PostgREST typed API, so
  // the null case goes through `.is()`.
  let query =
    table === 'brands'
      ? supabase.from('brands').select('id', { count: 'exact' }).ilike('name', pattern)
      : supabase.from('categories').select('id', { count: 'exact' }).ilike('name', pattern);
  if (table === 'categories') {
    const parentId = options.parentId ?? null;
    query = parentId === null ? query.is('parent_id', null) : query.eq('parent_id', parentId);
  }
  if (options.excludeId) {
    query = query.neq('id', options.excludeId);
  }
  const { count } = await query.limit(1);
  return (count ?? 0) > 0;
}

/** Ancestor hops checked before deciding a chain is deeper than any real tree. */
const CATEGORY_MAX_DEPTH = 20;

/**
 * Would moving `categoryId` under `newParentId` create a parent cycle
 * (A → B → A)? The direct self-parent case is rejected before this runs;
 * this walks up from the proposed parent looking for the category itself.
 * Real category trees are a few levels deep, so more than CATEGORY_MAX_DEPTH
 * hops means the existing chain is corrupt — the walk gives up and allows the
 * write rather than bricking edits on data that needs manual repair anyway.
 */
async function categoryWouldCreateCycle(
  supabase: MasterSupabaseClient,
  categoryId: string,
  newParentId: string
): Promise<boolean> {
  let cursor: string | null = newParentId;
  for (let depth = 0; depth < CATEGORY_MAX_DEPTH && cursor; depth += 1) {
    if (cursor === categoryId) return true;
    const { data }: { data: { parent_id: string | null } | null } = await supabase
      .from('categories')
      .select('parent_id')
      .eq('id', cursor)
      .maybeSingle<{ parent_id: string | null }>();
    if (!data) return false; // Dangling parent id — the FK rejects the write.
    cursor = data.parent_id;
  }
  return false;
}

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
  logoUrl: optionalMediaRefSchema,
});

type BrandInsert = Database['public']['Tables']['brands']['Insert'];

/** Parse the brand form fields the shared zod schema does not cover. */
function parseBrandForm(formData: FormData) {
  const parsed = brandSchema.safeParse({ logoUrl: formData.get('logoUrl') ?? '' });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid input.' };
  }
  const name = normalizeMasterName(formData.get('name'));
  const nameError = validateBrandName(name);
  if (nameError) return { error: nameError };
  return { name, logoUrl: parsed.data.logoUrl || null };
}

export async function createBrandAction(
  _prevState: MasterDataFormState,
  formData: FormData
): Promise<MasterDataFormState> {
  await requirePermission('master_data.manage');

  const form = parseBrandForm(formData);
  if ('error' in form) return { error: form.error };

  const supabase = createClient();
  const exists = await masterNameExists(supabase, 'brands', form.name);
  const duplicate = duplicateNameError(exists, 'brand');
  if (duplicate) return { error: duplicate };

  const payload: BrandInsert = { name: form.name, logo_url: form.logoUrl };
  const { error } = await supabase.from('brands').insert(payload as unknown as never);
  if (error) return { error: error.message.includes('duplicate') ? 'A brand with this name already exists.' : error.message };

  revalidatePath(BRANDS_LIST_PATH);
  return null;
}

export async function toggleBrandActiveAction(brandId: string, isActive: boolean) {
  await requirePermission('master_data.manage');
  const supabase = createClient();
  const { error } = await supabase.from('brands').update({ is_active: isActive } as unknown as never).eq('id', brandId);
  if (error) throw new Error(error.message);
  revalidatePath(BRANDS_LIST_PATH);
}

export async function updateBrandAction(
  brandId: string,
  _prevState: MasterDataFormState,
  formData: FormData
): Promise<MasterDataFormState> {
  await requirePermission('master_data.manage');

  const form = parseBrandForm(formData);
  if ('error' in form) return { error: form.error };

  const supabase = createClient();

  const exists = await masterNameExists(supabase, 'brands', form.name, { excludeId: brandId });
  const duplicate = duplicateNameError(exists, 'brand');
  if (duplicate) return { error: duplicate };

  // If the logo was replaced, remember the previous reference so the old
  // file can be cleaned up after the row update succeeds.
  const { data: existing } = await supabase
    .from('brands')
    .select('logo_url')
    .eq('id', brandId)
    .maybeSingle<{ logo_url: string | null }>();

  const payload: Partial<BrandInsert> = {
    name: form.name,
    logo_url: form.logoUrl,
  };
  const { error } = await supabase.from('brands').update(payload as unknown as never).eq('id', brandId);
  if (error) {
    return { error: error.message.includes('duplicate') ? 'A brand with this name already exists.' : error.message };
  }

  if (existing?.logo_url && existing.logo_url !== payload.logo_url) {
    await deleteMedia(existing.logo_url);
  }

  revalidatePath(BRANDS_LIST_PATH);
  redirect(BRANDS_LIST_PATH);
}

export async function deleteBrandAction(brandId: string) {
  // RLS (0005) already restricts brand/category DELETE to admin and above;
  // this permission mirrors that boundary at the app layer, exactly like
  // products.delete does for products.
  await requirePermission('master_data.delete');
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

  revalidatePath(BRANDS_LIST_PATH);
}

// ----------------------------------------------------------------------------
// Categories
// ----------------------------------------------------------------------------

const categorySchema = z.object({
  parentId: z.string().uuid().optional().or(z.literal('')),
  imageUrl: optionalMediaRefSchema,
});

type CategoryInsert = Database['public']['Tables']['categories']['Insert'];

/** Parse the category form fields the shared zod schema does not cover. */
function parseCategoryForm(formData: FormData) {
  const parsed = categorySchema.safeParse({
    parentId: formData.get('parentId'),
    imageUrl: formData.get('imageUrl') ?? '',
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid input.' };
  }
  const name = normalizeMasterName(formData.get('name'));
  const nameError = validateCategoryName(name);
  if (nameError) return { error: nameError };
  const sort = parseSortOrder(formData.get('sortOrder'));
  if (sort.error) return { error: sort.error };
  return {
    name,
    parentId: parsed.data.parentId || null,
    imageUrl: parsed.data.imageUrl || null,
    sortOrder: sort.value ?? 0,
  };
}

export async function createCategoryAction(
  _prevState: MasterDataFormState,
  formData: FormData
): Promise<MasterDataFormState> {
  await requirePermission('master_data.manage');

  const form = parseCategoryForm(formData);
  if ('error' in form) return { error: form.error };

  const supabase = createClient();
  const exists = await masterNameExists(supabase, 'categories', form.name, { parentId: form.parentId });
  const duplicate = duplicateNameError(exists, 'category');
  if (duplicate) return { error: duplicate };

  const payload: CategoryInsert = {
    name: form.name,
    parent_id: form.parentId,
    image_url: form.imageUrl,
    sort_order: form.sortOrder,
  };
  const { error } = await supabase.from('categories').insert(payload as unknown as never);
  if (error) return { error: error.message.includes('duplicate') ? 'This category already exists under the selected parent.' : error.message };

  revalidatePath(CATEGORIES_LIST_PATH);
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
  revalidatePath(CATEGORIES_LIST_PATH);
}

export async function updateCategoryAction(
  categoryId: string,
  _prevState: MasterDataFormState,
  formData: FormData
): Promise<MasterDataFormState> {
  await requirePermission('master_data.manage');

  const form = parseCategoryForm(formData);
  if ('error' in form) return { error: form.error };
  if (form.parentId === categoryId) {
    return { error: 'A category cannot be its own parent.' };
  }

  const supabase = createClient();

  if (form.parentId && (await categoryWouldCreateCycle(supabase, categoryId, form.parentId))) {
    return { error: 'That parent would create a category cycle. Pick a category higher up the tree.' };
  }

  const exists = await masterNameExists(supabase, 'categories', form.name, {
    parentId: form.parentId,
    excludeId: categoryId,
  });
  const duplicate = duplicateNameError(exists, 'category');
  if (duplicate) return { error: duplicate };

  // If the image was replaced, remember the previous reference so the old
  // file can be cleaned up after the row update succeeds.
  const { data: existing } = await supabase
    .from('categories')
    .select('image_url')
    .eq('id', categoryId)
    .maybeSingle<{ image_url: string | null }>();

  const payload: Partial<CategoryInsert> = {
    name: form.name,
    parent_id: form.parentId,
    image_url: form.imageUrl,
    sort_order: form.sortOrder,
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

  revalidatePath(CATEGORIES_LIST_PATH);
  redirect(CATEGORIES_LIST_PATH);
}

export async function deleteCategoryAction(categoryId: string) {
  // RLS (0005) already restricts brand/category DELETE to admin and above;
  // this permission mirrors that boundary at the app layer, exactly like
  // products.delete does for products.
  await requirePermission('master_data.delete');
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

  revalidatePath(CATEGORIES_LIST_PATH);
}
