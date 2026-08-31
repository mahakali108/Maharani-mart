'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { requirePermission } from '@/lib/admin/guard';
import { deleteMedia } from '@/lib/media';
import type { Database } from '@/types/database.types';

export type ProductFormState = { error?: string } | null;

type ProductInsert = Database['public']['Tables']['products']['Insert'];
type ProductUpdate = Database['public']['Tables']['products']['Update'];
type ProductImageInsert = Database['public']['Tables']['product_images']['Insert'];
type ProductPackInsert = Database['public']['Tables']['product_packs']['Insert'];

const productSchema = z.object({
  skuCode: z.string().min(2, 'Enter a SKU code.'),
  name: z.string().min(2, 'Enter a product name.'),
  brandId: z.string().uuid().optional().or(z.literal('')),
  categoryId: z.string().uuid().optional().or(z.literal('')),
  unit: z.string().min(1, 'Enter a unit (e.g. carton, box, pcs).'),
  unitsPerCase: z.coerce.number().int().min(1, 'Units per case must be at least 1.').default(1),
  basePrice: z.coerce.number().min(0, 'Enter a valid MRP.'),
  costPrice: z.coerce.number().min(0).optional().or(z.literal('')),
  casePrice: z.coerce.number().min(0, 'Enter a valid case selling price.'),
  gstPercent: z.coerce.number().min(0).max(100).default(0),
  barcode: z.string().optional(),
  leadTimeDays: z.coerce.number().int().min(0).default(2),
  isNewLaunch: z.coerce.boolean().default(false),
});

function parseProductForm(formData: FormData) {
  return productSchema.safeParse({
    skuCode: formData.get('skuCode'),
    name: formData.get('name'),
    brandId: formData.get('brandId'),
    categoryId: formData.get('categoryId'),
    unit: formData.get('unit'),
    unitsPerCase: formData.get('unitsPerCase') || 1,
    basePrice: formData.get('basePrice'),
    costPrice: formData.get('costPrice') || '',
    casePrice: formData.get('casePrice'),
    gstPercent: formData.get('gstPercent') || 0,
    barcode: formData.get('barcode'),
    leadTimeDays: formData.get('leadTimeDays') || 2,
    isNewLaunch: formData.get('isNewLaunch') === 'on',
  });
}

/**
 * Seeds a default case-priced pack for a product, together with its default
 * and case quantity tiers, so a product created through the Add Product form
 * is immediately orderable at the configured case price. The default pack's
 * SKU mirrors the product SKU so updates stay linked.
 */
async function seedDefaultPackForProduct(
  supabase: ReturnType<typeof createClient>,
  productId: string,
  user: { id: string },
  d: {
    skuCode: string;
    unit: string;
    unitsPerCase: number;
    basePrice: number;
    costPrice: number | null;
    casePrice: number;
    barcode: string | null;
  }
) {
  const piecePrice = Math.round((d.casePrice / Math.max(1, d.unitsPerCase)) * 100) / 100;
  const { data: pack, error } = await supabase
    .from('product_packs')
    .insert({
      product_id: productId,
      pack_name: d.unit || 'Default',
      pack_sku_code: d.skuCode,
      units_per_case: d.unitsPerCase,
      base_price: d.basePrice,
      mrp: d.basePrice,
      cost_price: d.costPrice,
      case_price: d.casePrice,
      barcode: d.barcode,
      moq: 1,
      created_by: user.id,
    } as unknown as never)
    .select('id')
    .single<{ id: string }>();
  if (error || !pack) return;

  // Quantity tiers (in PIECES), half-open [min, max):
  //  - default: [1, units)  — normal applicable pricing below a full case
  //  - case:    [units, ∞)  — at a full case the fixed case price applies
  // For single-piece packs (units=1) one default tier [1, ∞) is enough.
  const tiers =
    d.unitsPerCase > 1
      ? [
          {
            product_pack_id: pack.id,
            min_quantity: 1,
            max_quantity: d.unitsPerCase,
            price_per_piece: piecePrice,
            rule_type: 'default' as const,
            label: 'Default',
            created_by: user.id,
          },
          {
            product_pack_id: pack.id,
            min_quantity: d.unitsPerCase,
            max_quantity: null,
            price_per_piece: piecePrice,
            rule_type: 'case' as const,
            label: 'Case price',
            created_by: user.id,
          },
        ]
      : [
          {
            product_pack_id: pack.id,
            min_quantity: 1,
            max_quantity: null,
            price_per_piece: piecePrice,
            rule_type: 'default' as const,
            label: 'Default',
            created_by: user.id,
          },
        ];
  await supabase.from('product_pricing_tiers').insert(tiers as unknown as never);
}

export async function createProductAction(
  _prevState: ProductFormState,
  formData: FormData
): Promise<ProductFormState> {
  const user = await requirePermission('products.create');

  const parsed = parseProductForm(formData);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid input.' };
  }
  const d = parsed.data;

  const supabase = createClient();
  const cost = d.costPrice === '' ? null : Number(d.costPrice);
  const payload: ProductInsert = {
    sku_code: d.skuCode,
    name: d.name,
    brand_id: d.brandId || null,
    category_id: d.categoryId || null,
    unit: d.unit,
    units_per_case: d.unitsPerCase,
    base_price: d.basePrice,
    cost_price: cost,
    gst_percent: d.gstPercent,
    barcode: d.barcode || null,
    lead_time_days: d.leadTimeDays,
    is_new_launch: d.isNewLaunch,
    created_by: user.id,
  };

  const { data, error } = await supabase
    .from('products')
    .insert(payload as unknown as never)
    .select('id')
    .single<{ id: string }>();

  if (error) {
    return {
      error: error.message.includes('duplicate')
        ? 'A product with this SKU code or barcode already exists.'
        : error.message,
    };
  }

  // Seed a default case-priced pack (with quantity tiers) so the product is
  // immediately orderable at the configured case price.
  await seedDefaultPackForProduct(supabase, data.id, user, {
    skuCode: d.skuCode,
    unit: d.unit,
    unitsPerCase: d.unitsPerCase,
    basePrice: d.basePrice,
    costPrice: cost,
    casePrice: d.casePrice,
    barcode: d.barcode || null,
  });

  revalidatePath('/admin/products');
  redirect(`/admin/products/${data.id}`);
}

export async function updateProductAction(
  productId: string,
  _prevState: ProductFormState,
  formData: FormData
): Promise<ProductFormState> {
  await requirePermission('products.edit');

  const parsed = parseProductForm(formData);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid input.' };
  }
  const d = parsed.data;

  const supabase = createClient();
  const cost = d.costPrice === '' ? null : Number(d.costPrice);
  const payload: ProductUpdate = {
    sku_code: d.skuCode,
    name: d.name,
    brand_id: d.brandId || null,
    category_id: d.categoryId || null,
    unit: d.unit,
    units_per_case: d.unitsPerCase,
    base_price: d.basePrice,
    cost_price: cost,
    gst_percent: d.gstPercent,
    barcode: d.barcode || null,
    lead_time_days: d.leadTimeDays,
    is_new_launch: d.isNewLaunch,
  };

  const { error } = await supabase
    .from('products')
    .update(payload as unknown as never)
    .eq('id', productId);

  if (error) return { error: error.message };

  // Keep the auto-seeded default pack (pack SKU == product SKU) in sync with
  // the case-based pricing fields so editing the product updates the orderable
  // case price / units / MRP / cost / barcode, and its default tier price.
  const { data: defaultPack } = await supabase
    .from('product_packs')
    .select('id')
    .eq('product_id', productId)
    .eq('pack_sku_code', d.skuCode)
    .maybeSingle<{ id: string }>();
  if (defaultPack) {
    const piecePrice = Math.round((d.casePrice / Math.max(1, d.unitsPerCase)) * 100) / 100;
    await supabase
      .from('product_packs')
      .update({
        units_per_case: d.unitsPerCase,
        base_price: d.basePrice,
        mrp: d.basePrice,
        cost_price: cost,
        case_price: d.casePrice,
        barcode: d.barcode || null,
      } as unknown as never)
      .eq('id', defaultPack.id);
    // Refresh the default/case tier prices to stay anchored to the case price.
    await supabase
      .from('product_pricing_tiers')
      .update({ price_per_piece: piecePrice } as unknown as never)
      .eq('product_pack_id', defaultPack.id)
      .in('rule_type', ['default', 'case']);
  }

  revalidatePath('/admin/products');
  revalidatePath(`/admin/products/${productId}`);
  return null;
}

export async function toggleProductActiveAction(productId: string, isActive: boolean) {
  await requirePermission('products.edit');
  const supabase = createClient();
  const { error } = await supabase
    .from('products')
    .update({ is_active: isActive } as unknown as never)
    .eq('id', productId);
  if (error) throw new Error(error.message);
  revalidatePath('/admin/products');
}

export async function deleteProductAction(productId: string) {
  await requirePermission('products.delete');
  const supabase = createClient();
  const { error } = await supabase.from('products').delete().eq('id', productId);
  if (error) throw new Error(error.message);
  revalidatePath('/admin/products');
  redirect('/admin/products');
}

// ----------------------------------------------------------------------------
// Product images
// ----------------------------------------------------------------------------

export async function addProductImageAction(productId: string, imageUrl: string, sortOrder: number) {
  await requirePermission('products.edit');
  const supabase = createClient();
  const payload: ProductImageInsert = { product_id: productId, image_url: imageUrl, sort_order: sortOrder };
  const { error } = await supabase.from('product_images').insert(payload as unknown as never);
  if (error) throw new Error(error.message);
  revalidatePath(`/admin/products/${productId}`);
}

export async function removeProductImageAction(imageId: string, productId: string) {
  await requirePermission('products.edit');
  const supabase = createClient();

  const { data, error } = await supabase
    .from('product_images')
    .delete()
    .eq('id', imageId)
    .select('image_url')
    .maybeSingle<{ image_url: string }>();
  if (error) throw new Error(error.message);

  // Clean up the stored file too, so removing an image doesn't orphan it.
  // deleteMedia() is best-effort and only removes Supabase objects it can
  // confidently identify; legacy files are never auto-deleted en masse.
  if (data) {
    await deleteMedia(data.image_url);
  }

  revalidatePath(`/admin/products/${productId}`);
}

export async function reorderProductImageAction(productId: string, imageId: string, direction: 'up' | 'down') {
  await requirePermission('products.edit');
  const supabase = createClient();
  const { data } = await supabase
    .from('product_images')
    .select('id, sort_order')
    .eq('product_id', productId)
    .order('sort_order')
    .returns<SortableRow[]>();

  if (data) await swapSortOrder('product_images', data, imageId, direction);
  revalidatePath(`/admin/products/${productId}`);
}

// ----------------------------------------------------------------------------
// Product packs
// ----------------------------------------------------------------------------

const packSchema = z.object({
  packName: z.string().min(1, 'Enter a pack name (e.g. "1 Kg", "5 Kg", "6-pack", "Case of 12").'),
  packSkuCode: z.string().min(1, 'Enter a pack SKU code.'),
  unitsPerCase: z.coerce.number().int().min(1, 'Units per case must be at least 1.').default(1),
  mrp: z.coerce.number().min(0, 'Enter a valid MRP.'),
  costPrice: z.coerce.number().min(0).optional().or(z.literal('')),
  casePrice: z.coerce.number().min(0, 'Enter a valid case selling price.'),
  moq: z.coerce.number().int().min(1).default(1),
  barcode: z.string().optional(),
});

export type PackFormState = { error?: string } | null;

export async function addProductPackAction(
  productId: string,
  _prevState: PackFormState,
  formData: FormData
): Promise<PackFormState> {
  const user = await requirePermission('products.edit');

  const parsed = packSchema.safeParse({
    packName: formData.get('packName'),
    packSkuCode: formData.get('packSkuCode'),
    unitsPerCase: formData.get('unitsPerCase') || 1,
    mrp: formData.get('mrp'),
    costPrice: formData.get('costPrice') || '',
    casePrice: formData.get('casePrice'),
    moq: formData.get('moq') || 1,
    barcode: formData.get('barcode'),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid input.' };
  }
  const d = parsed.data;

  const supabase = createClient();
  const payload: ProductPackInsert = {
    product_id: productId,
    pack_name: d.packName,
    pack_sku_code: d.packSkuCode,
    units_per_case: d.unitsPerCase,
    base_price: d.mrp,
    mrp: d.mrp,
    cost_price: d.costPrice === '' ? null : Number(d.costPrice),
    case_price: d.casePrice,
    moq: d.moq,
    barcode: d.barcode || null,
    created_by: user.id,
  };

  const { data: pack, error } = await supabase
    .from('product_packs')
    .insert(payload as unknown as never)
    .select('id')
    .maybeSingle<{ id: string }>();
  if (error) {
    return {
      error: error.message.includes('duplicate') ? 'A pack with this SKU code or barcode already exists.' : error.message,
    };
  }

  // Seed default + case tiers anchored to the case price.
  if (pack) {
    const piecePrice = Math.round((d.casePrice / Math.max(1, d.unitsPerCase)) * 100) / 100;
    const tiers =
      d.unitsPerCase > 1
        ? [
            {
              product_pack_id: pack.id,
              min_quantity: 1,
              max_quantity: d.unitsPerCase,
              price_per_piece: piecePrice,
              rule_type: 'default' as const,
              label: 'Default',
              created_by: user.id,
            },
            {
              product_pack_id: pack.id,
              min_quantity: d.unitsPerCase,
              max_quantity: null,
              price_per_piece: piecePrice,
              rule_type: 'case' as const,
              label: 'Case price',
              created_by: user.id,
            },
          ]
        : [
            {
              product_pack_id: pack.id,
              min_quantity: 1,
              max_quantity: null,
              price_per_piece: piecePrice,
              rule_type: 'default' as const,
              label: 'Default',
              created_by: user.id,
            },
          ];
    await supabase.from('product_pricing_tiers').insert(tiers as unknown as never);
  }

  revalidatePath(`/admin/products/${productId}`);
  return null;
}

export async function togglePackActiveAction(packId: string, productId: string, isActive: boolean) {
  await requirePermission('products.edit');
  const supabase = createClient();
  const { error } = await supabase
    .from('product_packs')
    .update({ is_active: isActive } as unknown as never)
    .eq('id', packId);
  if (error) throw new Error(error.message);
  revalidatePath(`/admin/products/${productId}`);
}

export async function deleteProductPackAction(packId: string, productId: string) {
  await requirePermission('products.delete');
  const supabase = createClient();
  const { error } = await supabase.from('product_packs').delete().eq('id', packId);
  if (error) throw new Error(error.message);
  revalidatePath(`/admin/products/${productId}`);
}

interface SortableRow {
  id: string;
  sort_order: number;
}

/**
 * Swaps sort_order with the adjacent row in the given direction —
 * used for both pack and image reordering below, without pulling in
 * a drag-and-drop library for Phase 2A.
 */
async function swapSortOrder(
  table: 'product_packs' | 'product_images',
  rows: SortableRow[],
  rowId: string,
  direction: 'up' | 'down'
) {
  const supabase = createClient();
  const index = rows.findIndex((r) => r.id === rowId);
  const swapIndex = direction === 'up' ? index - 1 : index + 1;
  if (index === -1 || swapIndex < 0 || swapIndex >= rows.length) return;

  const current = rows[index];
  const swap = rows[swapIndex];
  // With `noUncheckedIndexedAccess` enabled, TypeScript can't infer
  // from the bounds check above that these are defined — the check
  // guards the *numeric* indices, not the array-access expressions
  // themselves. This guard makes that guarantee explicit for the
  // compiler (and safe at runtime, in case `rows` mutates between the
  // findIndex call and here).
  if (!current || !swap) return;

  await Promise.all([
    supabase.from(table).update({ sort_order: swap.sort_order } as unknown as never).eq('id', current.id),
    supabase.from(table).update({ sort_order: current.sort_order } as unknown as never).eq('id', swap.id),
  ]);
}

export async function movePackAction(productId: string, packId: string, direction: 'up' | 'down') {
  await requirePermission('products.edit');
  const supabase = createClient();
  const { data } = await supabase
    .from('product_packs')
    .select('id, sort_order')
    .eq('product_id', productId)
    .order('sort_order')
    .returns<SortableRow[]>();

  if (data) await swapSortOrder('product_packs', data, packId, direction);
  revalidatePath(`/admin/products/${productId}`);
}

// ----------------------------------------------------------------------------
// Case-based pricing tiers (quantity slabs) for a pack
// ----------------------------------------------------------------------------

export type TierFormState = { error?: string } | null;

const tierSchema = z.object({
  minQuantity: z.coerce.number().int().min(1, 'Minimum quantity must be at least 1.'),
  maxQuantity: z.coerce.number().int().optional().or(z.literal('')),
  pricePerPiece: z.coerce.number().min(0, 'Price per piece cannot be negative.'),
  label: z.string().optional(),
});

export async function addPricingTierAction(
  packId: string,
  productId: string,
  _prevState: TierFormState,
  formData: FormData
): Promise<TierFormState> {
  const user = await requirePermission('products.edit');
  const parsed = tierSchema.safeParse({
    minQuantity: formData.get('minQuantity'),
    maxQuantity: formData.get('maxQuantity') || '',
    pricePerPiece: formData.get('pricePerPiece'),
    label: formData.get('label'),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid pricing rule.' };
  }
  const d = parsed.data;

  const supabase = createClient();
  const { error } = await supabase.from('product_pricing_tiers').insert({
    product_pack_id: packId,
    min_quantity: d.minQuantity,
    max_quantity: d.maxQuantity === '' ? null : Number(d.maxQuantity),
    price_per_piece: d.pricePerPiece,
    rule_type: 'bulk',
    label: d.label?.trim() || 'Bulk discount',
    created_by: user.id,
  } as unknown as never);
  if (error) return { error: error.message };

  revalidatePath(`/admin/products/${productId}`);
  return null;
}

export async function updatePricingTierAction(
  tierId: string,
  productId: string,
  _prevState: TierFormState,
  formData: FormData
): Promise<TierFormState> {
  await requirePermission('products.edit');
  const parsed = tierSchema.safeParse({
    minQuantity: formData.get('minQuantity'),
    maxQuantity: formData.get('maxQuantity') || '',
    pricePerPiece: formData.get('pricePerPiece'),
    label: formData.get('label'),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid pricing rule.' };
  }
  const d = parsed.data;

  const supabase = createClient();
  const { error } = await supabase
    .from('product_pricing_tiers')
    .update({
      min_quantity: d.minQuantity,
      max_quantity: d.maxQuantity === '' ? null : Number(d.maxQuantity),
      price_per_piece: d.pricePerPiece,
      label: d.label?.trim() || 'Bulk discount',
    } as unknown as never)
    .eq('id', tierId);
  if (error) return { error: error.message };

  revalidatePath(`/admin/products/${productId}`);
  return null;
}

export async function deletePricingTierAction(tierId: string, productId: string) {
  await requirePermission('products.edit');
  const supabase = createClient();
  const { error } = await supabase.from('product_pricing_tiers').delete().eq('id', tierId);
  if (error) throw new Error(error.message);
  revalidatePath(`/admin/products/${productId}`);
}
