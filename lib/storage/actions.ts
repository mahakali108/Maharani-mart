'use server';

import { revalidatePath } from 'next/cache';
import { requirePermission } from '@/lib/admin/guard';
import { requireUser } from '@/lib/auth/session';
import { createClient } from '@/lib/supabase/server';
import { remove, replace, upload } from '@/lib/storage';
import { FIREBASE_NOT_CONFIGURED, isFirebaseAdminConfigured } from '@/lib/storage/firebase/env';
import { assertPathOwned, assertStableId } from '@/lib/storage/paths';
import { isFirebaseObjectPath } from '@/lib/storage/urls';
import { fileToBytes } from '@/lib/storage/validate';
import type { StorageKind } from '@/lib/storage/types';
import type { Database } from '@/types/database.types';

type ProductImageInsert = Database['public']['Tables']['product_images']['Insert'];
type RetailerDocumentInsert = Database['public']['Tables']['retailer_documents']['Insert'];
type ProfileUpdate = Database['public']['Tables']['profiles']['Update'];

export type StorageActionResult = {
  error?: string;
  path?: string;
  url?: string | null;
  ownerId?: string;
};

function configuredOrError(): StorageActionResult | null {
  if (!isFirebaseAdminConfigured()) {
    return { error: FIREBASE_NOT_CONFIGURED };
  }
  return null;
}

async function readUpload(formData: FormData): Promise<{ file: File } | { error: string }> {
  const file = formData.get('file');
  if (!(file instanceof File) || file.size === 0) {
    return { error: 'Choose a file to upload.' };
  }
  return { file };
}

async function safeRemoveFirebasePath(path: string, kind: StorageKind, ownerId: string) {
  if (!isFirebaseObjectPath(path)) return;
  try {
    assertPathOwned(path, kind, ownerId);
    await remove(path);
  } catch {
    // Best-effort cleanup — never fail the DB mutation because a file is already gone.
  }
}

export async function uploadProductImageAction(productId: string, formData: FormData): Promise<StorageActionResult> {
  const denied = configuredOrError();
  if (denied) return denied;
  await requirePermission('products.edit');
  assertStableId(productId, 'product id');

  const parsed = await readUpload(formData);
  if ('error' in parsed) return parsed;

  const supabase = createClient();
  const { data: product } = await supabase.from('products').select('id').eq('id', productId).maybeSingle<{ id: string }>();
  if (!product) return { error: 'Product not found.' };

  const { count } = await supabase
    .from('product_images')
    .select('id', { count: 'exact', head: true })
    .eq('product_id', productId);

  try {
    const bytes = await fileToBytes(parsed.file);
    const uploaded = await upload({
      kind: 'product',
      ownerId: productId,
      bytes,
      filename: parsed.file.name,
      declaredType: parsed.file.type,
      variant: (count ?? 0) === 0 ? 'main' : 'gallery',
    });

    const payload: ProductImageInsert = {
      product_id: productId,
      image_url: uploaded.path,
      sort_order: count ?? 0,
    };
    const { error } = await supabase.from('product_images').insert(payload as unknown as never);
    if (error) {
      await safeRemoveFirebasePath(uploaded.path, 'product', productId);
      return { error: error.message };
    }

    revalidatePath(`/admin/products/${productId}`);
    return { path: uploaded.path, url: uploaded.url };
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Upload failed.' };
  }
}

export async function uploadBannerImageAction(formData: FormData): Promise<StorageActionResult> {
  const denied = configuredOrError();
  if (denied) return denied;
  await requirePermission('banners.manage');

  const parsed = await readUpload(formData);
  if ('error' in parsed) return parsed;

  const existingId = formData.get('ownerId');
  const ownerId = typeof existingId === 'string' && existingId ? existingId : crypto.randomUUID();
  try {
    assertStableId(ownerId, 'banner id');
    const previous = formData.get('previousPath');
    const bytes = await fileToBytes(parsed.file);
    const uploaded = await replace({
      kind: 'banner',
      ownerId,
      bytes,
      filename: parsed.file.name,
      declaredType: parsed.file.type,
      previousPath: typeof previous === 'string' ? previous : null,
    });
    return { path: uploaded.path, url: uploaded.url, ownerId };
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Upload failed.' };
  }
}

export async function uploadBrandLogoAction(brandId: string, formData: FormData): Promise<StorageActionResult> {
  const denied = configuredOrError();
  if (denied) return denied;
  await requirePermission('master_data.manage');
  assertStableId(brandId, 'brand id');

  const parsed = await readUpload(formData);
  if ('error' in parsed) return parsed;

  const supabase = createClient();
  const { data: brand } = await supabase
    .from('brands')
    .select('id, logo_url')
    .eq('id', brandId)
    .maybeSingle<{ id: string; logo_url: string | null }>();
  if (!brand) return { error: 'Brand not found.' };

  try {
    const bytes = await fileToBytes(parsed.file);
    const uploaded = await replace({
      kind: 'brand',
      ownerId: brandId,
      bytes,
      filename: parsed.file.name,
      declaredType: parsed.file.type,
      previousPath: brand.logo_url,
    });
    const { error } = await supabase
      .from('brands')
      .update({ logo_url: uploaded.path } as unknown as never)
      .eq('id', brandId);
    if (error) return { error: error.message };
    revalidatePath('/admin/catalog');
    revalidatePath(`/admin/catalog/brands/${brandId}`);
    return { path: uploaded.path, url: uploaded.url };
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Upload failed.' };
  }
}

export async function uploadCategoryImageAction(categoryId: string, formData: FormData): Promise<StorageActionResult> {
  const denied = configuredOrError();
  if (denied) return denied;
  await requirePermission('master_data.manage');
  assertStableId(categoryId, 'category id');

  const parsed = await readUpload(formData);
  if ('error' in parsed) return parsed;

  const supabase = createClient();
  const { data: category } = await supabase
    .from('categories')
    .select('id, image_url')
    .eq('id', categoryId)
    .maybeSingle<{ id: string; image_url: string | null }>();
  if (!category) return { error: 'Category not found.' };

  try {
    const bytes = await fileToBytes(parsed.file);
    const uploaded = await replace({
      kind: 'category',
      ownerId: categoryId,
      bytes,
      filename: parsed.file.name,
      declaredType: parsed.file.type,
      previousPath: category.image_url,
    });
    const { error } = await supabase
      .from('categories')
      .update({ image_url: uploaded.path } as unknown as never)
      .eq('id', categoryId);
    if (error) return { error: error.message };
    revalidatePath('/admin/catalog');
    revalidatePath(`/admin/catalog/categories/${categoryId}`);
    return { path: uploaded.path, url: uploaded.url };
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Upload failed.' };
  }
}

export async function uploadRetailerDocumentFileAction(
  retailerId: string,
  formData: FormData
): Promise<StorageActionResult> {
  const denied = configuredOrError();
  if (denied) return denied;
  const user = await requirePermission('retailers.approve');
  assertStableId(retailerId, 'retailer id');

  const parsed = await readUpload(formData);
  if ('error' in parsed) return parsed;

  const docType = formData.get('docType');
  if (typeof docType !== 'string' || !docType.trim()) {
    return { error: 'Select a document type.' };
  }

  const supabase = createClient();
  const { data: retailer } = await supabase.from('retailers').select('id').eq('id', retailerId).maybeSingle<{ id: string }>();
  if (!retailer) return { error: 'Retailer not found.' };

  try {
    const bytes = await fileToBytes(parsed.file);
    const uploaded = await upload({
      kind: 'retailer_document',
      ownerId: retailerId,
      bytes,
      filename: parsed.file.name,
      declaredType: parsed.file.type,
    });

    const payload: RetailerDocumentInsert = {
      retailer_id: retailerId,
      doc_type: docType.trim(),
      file_url: uploaded.path,
      file_name: parsed.file.name,
      uploaded_by: user.id,
    };
    const { error } = await supabase.from('retailer_documents').insert(payload as unknown as never);
    if (error) {
      await safeRemoveFirebasePath(uploaded.path, 'retailer_document', retailerId);
      return { error: error.message };
    }
    revalidatePath(`/admin/retailers/${retailerId}`);
    return { path: uploaded.path };
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Upload failed.' };
  }
}

/**
 * Authenticated user may upload only into their own profile folder.
 * No caller-supplied owner id is trusted.
 */
export async function uploadOwnProfileImageAction(formData: FormData): Promise<StorageActionResult> {
  const denied = configuredOrError();
  if (denied) return denied;
  const user = await requireUser();

  const parsed = await readUpload(formData);
  if ('error' in parsed) return parsed;

  const supabase = createClient();
  const { data: profile } = await supabase
    .from('profiles')
    .select('avatar_url')
    .eq('id', user.id)
    .maybeSingle<{ avatar_url: string | null }>();

  try {
    const bytes = await fileToBytes(parsed.file);
    const uploaded = await replace({
      kind: 'retailer_profile',
      ownerId: user.id,
      bytes,
      filename: parsed.file.name,
      declaredType: parsed.file.type,
      previousPath: profile?.avatar_url,
    });
    const payload: ProfileUpdate = { avatar_url: uploaded.path };
    const { error } = await supabase.from('profiles').update(payload as unknown as never).eq('id', user.id);
    if (error) return { error: error.message };
    return { path: uploaded.path, url: uploaded.url };
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Upload failed.' };
  }
}

export async function deleteStoredObjectAction(
  path: string,
  kind: StorageKind,
  ownerId: string
): Promise<StorageActionResult> {
  const denied = configuredOrError();
  if (denied) return denied;

  if (kind === 'retailer_profile') {
    const user = await requireUser();
    if (user.id !== ownerId) {
      return { error: 'You can only manage your own profile image.' };
    }
  } else if (kind === 'product') {
    await requirePermission('products.edit');
  } else if (kind === 'banner') {
    await requirePermission('banners.manage');
  } else if (kind === 'brand' || kind === 'category') {
    await requirePermission('master_data.manage');
  } else if (kind === 'retailer_document') {
    await requirePermission('retailers.approve');
  }

  try {
    assertPathOwned(path, kind, ownerId);
    await remove(path);
    return {};
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Delete failed.' };
  }
}
