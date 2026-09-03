'use server';

import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { requirePermission } from '@/lib/admin/guard';
import { loadPackCost } from '@/lib/admin/cost-access';
import { deleteMedia } from '@/lib/media';
import { isRenderableMediaRef } from '@/lib/media/refs';
import {
  findLooseCoverageGaps,
  piecePriceFromCase,
  looseTierDraftToRow,
  maxLooseQuantity,
  validateLooseTierSet,
  type LooseTierDraft,
} from '@/lib/retailer/case-pricing';
import type { Database } from '@/types/database.types';

export type ProductFormState = { error?: string } | null;

type ProductInsert = Database['public']['Tables']['products']['Insert'];
type ProductUpdate = Database['public']['Tables']['products']['Update'];
type ProductImageInsert = Database['public']['Tables']['product_images']['Insert'];
type ProductPackInsert = Database['public']['Tables']['product_packs']['Insert'];

const productSchema = z.object({
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
 * Builds the internal pack SKU for the auto-seeded default pack.
 *
 * Products no longer carry an admin-entered SKU code (migration 0023), but
 * `product_packs.pack_sku_code` is still a NOT NULL UNIQUE column, so the
 * default pack gets a deterministic code derived from the product id. It is
 * never entered by an admin and is unique per product.
 */
function defaultPackSkuCode(productId: string) {
  return `PK-${productId.replaceAll('-', '').slice(0, 12).toUpperCase()}`;
}

/**
 * Internal identifier for an admin-created variant/pack.
 *
 * SKU codes were removed from the user-facing workflow (migration 0023), but
 * `product_packs.pack_sku_code` is still a NOT NULL UNIQUE column that legacy
 * inventory/reporting readers depend on. An admin adding a new size therefore
 * never types a code: one is generated here, unique per pack, so unlimited
 * variants (30g, 750g, 2kg, ...) can be created without inventing codes.
 */
function generatePackSkuCode(productId: string) {
  const product = productId.replaceAll('-', '').slice(0, 8).toUpperCase();
  const unique = randomUUID().replaceAll('-', '').slice(0, 8).toUpperCase();
  return `PKV-${product}-${unique}`;
}

/**
 * Resolves the auto-seeded default pack of a product — the first pack by
 * sort order (then creation time). Before SKU codes were removed this pack was
 * identified by `pack_sku_code === products.sku_code`; ordering is now the
 * stable link between the product form and the pack it keeps in sync.
 */
async function findDefaultPackId(supabase: ReturnType<typeof createClient>, productId: string) {
  const { data } = await supabase
    .from('product_packs')
    .select('id')
    .eq('product_id', productId)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle<{ id: string }>();
  return data?.id ?? null;
}

/**
 * Seeds a default case-priced pack for a product, together with its default
 * and case quantity tiers, so a product created through the Add Product form
 * is immediately orderable at the configured case price.
 */
async function seedDefaultPackForProduct(
  supabase: ReturnType<typeof createClient>,
  productId: string,
  user: { id: string },
  d: {
    unit: string;
    unitsPerCase: number;
    basePrice: number;
    costPrice: number | null;
    casePrice: number;
    barcode: string | null;
  }
) {
  // Reference per-piece rate from the engine, so a seeded default slab prices
    // exactly like the derived rate the storefront shows.
    const piecePrice = piecePriceFromCase(d.casePrice, d.unitsPerCase);
  const { data: pack, error } = await supabase
    .from('product_packs')
    .insert({
      product_id: productId,
      pack_name: d.unit || 'Default',
      pack_sku_code: defaultPackSkuCode(productId),
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
  // `sku_code` is intentionally omitted — it was removed from the product
  // workflow and the database fills in a generated default (migration 0023).
  const payload: ProductInsert = {
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
        ? 'A product with this barcode already exists.'
        : error.message,
    };
  }

  // Seed a default case-priced pack (with quantity tiers) so the product is
  // immediately orderable at the configured case price.
  await seedDefaultPackForProduct(supabase, data.id, user, {
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
  // `sku_code` is left untouched so historical values survive an edit.
  const payload: ProductUpdate = {
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

  // Keep the auto-seeded default pack (the first pack by sort order) in sync
  // with the case-based pricing fields so editing the product updates the
  // orderable case price / units / MRP / cost / barcode, and its default tier
  // price.
  const defaultPackId = await findDefaultPackId(supabase, productId);
  if (defaultPackId) {
    // Reference per-piece rate from the engine, so a seeded default slab prices
    // exactly like the derived rate the storefront shows.
    const piecePrice = piecePriceFromCase(d.casePrice, d.unitsPerCase);
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
      .eq('id', defaultPackId);
    // Refresh the default/case tier prices to stay anchored to the case price.
    await supabase
      .from('product_pricing_tiers')
      .update({ price_per_piece: piecePrice } as unknown as never)
      .eq('product_pack_id', defaultPackId)
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
  // Optional: the admin never types a code — one is generated when omitted.
  packSkuCode: z.string().trim().max(64).optional().default(''),
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
  const d = {
    ...parsed.data,
    packSkuCode: parsed.data.packSkuCode || generatePackSkuCode(productId),
  };

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
    // A brand-new pack starts loose-friendly: the retailer is never forced to
    // buy a full case unless the admin switches this off deliberately.
    allow_loose_pieces: true,
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
      error: error.message.includes('duplicate')
        ? 'A pack with this barcode already exists. Check the barcode and try again.'
        : error.message,
    };
  }

  // Seed default + case tiers anchored to the case price.
  if (pack) {
    // Reference per-piece rate from the engine, so a seeded default slab prices
    // exactly like the derived rate the storefront shows.
    const piecePrice = piecePriceFromCase(d.casePrice, d.unitsPerCase);
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

/**
 * Sets or clears a variant's (pack's) own product image.
 *
 * The retailer-facing size switcher shows this image as the main product
 * image for that size, falling back to the parent product's gallery when
 * null. `imageUrl` must already be an uploaded, renderable media reference
 * (the MediaUploadField only produces those — raw client URLs are rejected
 * by `isRenderableMediaRef`). The pack must belong to `productId` so one
 * product's admin page can never mutate another product's packs. The
 * previous stored file is cleaned up best-effort, mirroring
 * removeProductImageAction.
 */
export async function setPackImageAction(packId: string, productId: string, imageUrl: string | null) {
  await requirePermission('products.edit');
  if (imageUrl !== null && !isRenderableMediaRef(imageUrl)) {
    throw new Error('Invalid image reference.');
  }

  const supabase = createClient();
  const { data: pack, error: fetchError } = await supabase
    .from('product_packs')
    .select('id, product_id, image_url')
    .eq('id', packId)
    .maybeSingle<{ id: string; product_id: string; image_url: string | null }>();
  if (fetchError) throw new Error(fetchError.message);
  if (!pack || pack.product_id !== productId) throw new Error('Pack not found for this product.');

  const { error } = await supabase
    .from('product_packs')
    .update({ image_url: imageUrl } as unknown as never)
    .eq('id', packId)
    .eq('product_id', productId);
  if (error) throw new Error(error.message);

  // Best-effort cleanup of the replaced/removed stored file.
  if (pack.image_url && pack.image_url !== imageUrl) {
    await deleteMedia(pack.image_url);
  }

  revalidatePath(`/admin/products/${productId}`);
  revalidatePath(`/retailer/catalog/${packId}`);
  revalidatePath('/retailer/catalog');
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
// Case + loose-piece pricing for a pack (migration 0026)
// ----------------------------------------------------------------------------
//
// ONE admin action owns a pack's whole pricing configuration: units per case,
// the GST-inclusive case price, MRP, MOQ (in pieces), whether loose pieces may be
// ordered at all, and the complete set of loose-piece tiers. The validation it
// applies is the validation the retailer-facing engine applies —
// `validateLooseTierSet` / `looseTierDraftToRow` / `findLooseCoverageGaps` from
// `lib/retailer/case-pricing` — so a configuration the admin is allowed to save
// is exactly a configuration the cart, quote and invoice can price without a
// surprise, and the admin preview and the checkout provably agree.
//
// The tier editor is a "save the whole set" operation instead of three separate
// add/update/delete endpoints: an overlapping or duplicated range could only
// ever be created between two partial writes, and the range rules forbid
// overlapping slabs outright.

/** One loose-piece slab exactly as the admin edits it (inclusive range, pcs). */
export interface LooseTierFormRow {
  /** Existing `product_pricing_tiers` id when editing a stored slab. */
  id: string | null;
  minQty: number;
  /** Inclusive upper bound in pieces; null = up to the last piece before a case. */
  maxQty: number | null;
  pricePerPiece: number;
  label: string | null;
}

export type PackPricingFormState = { error?: string; notice?: string } | null;

const looseTierRowSchema = z.object({
  id: z.string().uuid().nullish(),
  minQty: z.coerce.number(),
  maxQty: z.coerce.number().nullish(),
  pricePerPiece: z.coerce.number(),
  label: z.string().trim().max(80).nullish(),
});

const packPricingSchema = z.object({
  packId: z.string().uuid(),
  productId: z.string().uuid(),
  packName: z.string().trim().min(1, 'Enter a pack name (e.g. "Case of 40").'),
  unitsPerCase: z.coerce
    .number()
    .int('Units per case must be a whole number of pieces.')
    .min(1, 'Units per case must be at least 1 piece.'),
  casePrice: z.coerce
    .number()
    .positive('Enter the GST-inclusive case price — it must be more than ₹0.'),
  mrp: z.coerce.number().min(0, 'Enter a valid MRP.'),
  moq: z.coerce
    .number()
    .int('Minimum order quantity must be a whole number of pieces.')
    .min(1, 'Minimum order quantity must be at least 1 piece.'),
  allowLoosePieces: z.boolean(),
  acknowledgeGaps: z.boolean().default(false),
  tiers: z.array(looseTierRowSchema).max(50, 'A pack supports up to 50 loose-piece tiers.'),
});

export async function savePackPricingAction(input: z.input<typeof packPricingSchema>): Promise<PackPricingFormState> {
  const user = await requirePermission('products.edit');
  const parsed = packPricingSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid pricing configuration.' };
  }
  const d = parsed.data;
  const unitsPerCase = d.unitsPerCase;

  // Full cases are always priced by the case price, so a case-only pack has no
  // loose tiers to configure. Rejecting here keeps the two systems from
  // contradicting each other on the retailer screen.
  if (!d.allowLoosePieces && d.tiers.length > 0) {
    return {
      error:
        'This pack is set to full cases only, so loose tiers cannot be saved. Allow loose pieces, or remove the loose tiers.',
    };
  }

  const drafts: LooseTierDraft[] = d.tiers.map((tier) => ({
    minQty: Number(tier.minQty),
    maxQty: tier.maxQty === null || tier.maxQty === undefined ? null : Number(tier.maxQty),
    pricePerPiece: Number(tier.pricePerPiece),
  }));

  // Range rules: min>max, duplicates, overlaps, negatives, zero/negative price,
  // a slab reaching into full-case territory, invalid units per case.
  const tierErrors = validateLooseTierSet(drafts, unitsPerCase);
  if (tierErrors.length > 0) return { error: tierErrors.join(' ') };

  const rows = drafts.map((draft) => looseTierDraftToRow(draft, unitsPerCase));
  const gaps = findLooseCoverageGaps(rows, unitsPerCase);
  if (d.allowLoosePieces && rows.length > 0 && gaps.length > 0 && !d.acknowledgeGaps) {
    const ranges = gaps.map((gap) => (gap.min === gap.max ? `${gap.min} pc` : `${gap.min}–${gap.max} pcs`)).join(', ');
    return {
      error: `The loose tiers do not price every quantity below a case: ${ranges} ${
        gaps.length === 1 ? 'is' : 'are'
      } uncovered. Retailers ordering that many loose pieces would be blocked at checkout instead of silently repriced, so confirm the gap explicitly if that is what you want.`,
    };
  }

  const supabase = createClient();

  // The pack must belong to this product — never trust the id pair alone.
  const { data: existingPack, error: packReadError } = await supabase
    .from('product_packs')
    .select('id, units_per_case, allow_loose_pieces')
    .eq('id', d.packId)
    .eq('product_id', d.productId)
    .maybeSingle<{ id: string; units_per_case: number; allow_loose_pieces: boolean }>();
  if (packReadError) return { error: packReadError.message };
  if (!existingPack) return { error: 'That pack does not belong to this product.' };

  const { error: packError } = await supabase
    .from('product_packs')
    .update({
      pack_name: d.packName,
      units_per_case: unitsPerCase,
      // `base_price` mirrors MRP, exactly as the create path does, so legacy
      // reports that still read base_price keep showing the same number.
      base_price: d.mrp,
      mrp: d.mrp,
      case_price: d.casePrice,
      moq: d.moq,
      allow_loose_pieces: d.allowLoosePieces,
    } as unknown as never)
    .eq('id', d.packId);
  if (packError) return { error: packError.message };

  // --- tier sync ------------------------------------------------------------
  const { data: storedTiers, error: tierReadError } = await supabase
    .from('product_pricing_tiers')
    .select('id, min_quantity, max_quantity, rule_type')
    .eq('product_pack_id', d.packId)
    .eq('is_active', true)
    .returns<
      { id: string; min_quantity: number; max_quantity: number | null; rule_type: 'default' | 'case' | 'bulk' | 'loose' }[]
    >();
  if (tierReadError) return { error: tierReadError.message };

  const stored = storedTiers ?? [];
  const submittedIds = new Set(d.tiers.map((tier) => tier.id ?? null).filter((id): id is string => !!id));
  const looseCeiling = maxLooseQuantity(unitsPerCase);

  // Historical slabs ('default' / 'bulk') that reach into loose territory are
  // deactivated once the admin starts curating loose tiers, so a stale rule can
  // never reappear as the price of a remainder. Rows are deactivated rather
  // than deleted: order history, audit trails and rollbacks stay intact.
  const staleLegacyIds = stored
    .filter(
      (tier) =>
        rows.length > 0 &&
        tier.rule_type !== 'loose' &&
        tier.rule_type !== 'case' &&
        tier.min_quantity <= looseCeiling &&
        (tier.max_quantity === null || tier.max_quantity > 1)
    )
    .map((tier) => tier.id);

  const deactivateIds = [
    ...staleLegacyIds,
    ...stored.filter((tier) => tier.rule_type === 'loose' && !submittedIds.has(tier.id)).map((tier) => tier.id),
  ];
  if (deactivateIds.length > 0) {
    const { error: deactivateError } = await supabase
      .from('product_pricing_tiers')
      .update({ is_active: false, updated_at: new Date().toISOString() } as unknown as never)
      .in('id', deactivateIds);
    if (deactivateError) return { error: deactivateError.message };
  }

  const inserts: Record<string, unknown>[] = [];
  for (let index = 0; index < d.tiers.length; index += 1) {
    const tier = d.tiers[index]!;
    const row = rows[index]!;
    const payload = {
      product_pack_id: d.packId,
      min_quantity: row.min_quantity,
      max_quantity: row.max_quantity,
      price_per_piece: row.price_per_piece,
      rule_type: 'loose' as const,
      label: (tier.label ?? '').trim() || 'Loose pieces',
      is_active: true,
    };
    if (tier.id && submittedIds.has(tier.id)) {
      const { error } = await supabase
        .from('product_pricing_tiers')
        .update(payload as unknown as never)
        .eq('id', tier.id)
        .eq('product_pack_id', d.packId);
      if (error) return { error: error.message };
    } else {
      inserts.push({ ...payload, created_by: user.id });
    }
  }
  if (inserts.length > 0) {
    const { error } = await supabase.from('product_pricing_tiers').insert(inserts as unknown as never);
    if (error) return { error: error.message };
  }

  revalidatePath(`/admin/products/${d.productId}`);
  revalidatePath('/retailer/catalog');

  const notices: string[] = [];
  if (staleLegacyIds.length > 0) {
    notices.push(
      `Deactivated ${staleLegacyIds.length} legacy bulk rule(s) that overlapped loose quantities (1–${looseCeiling} pcs); orders already placed keep their stored prices.`
    );
  }
  if (gaps.length > 0 && rows.length > 0) {
    const ranges = gaps.map((gap) => (gap.min === gap.max ? `${gap.min} pc` : `${gap.min}–${gap.max} pcs`)).join(', ');
    notices.push(`Saved with an explicit gap: orders of ${ranges} loose pieces are blocked at checkout until a tier covers them.`);
  }
  return notices.length > 0 ? { notice: notices.join(' ') } : null;
}

// ----------------------------------------------------------------------------
// Duplicate a product pack (variant) — copies all attributes and tiers
// ----------------------------------------------------------------------------

/**
 * Safely duplicates a product pack (variant) within the same product.
 * The duplicate gets:
 *   - A new generated pack_sku_code (admin never types one)
 *   - "(Copy)" appended to the pack_name
 *   - All pricing tiers duplicated
 *   - Same image_url, units_per_case, MRP, cost, case_price, MOQ
 *   - is_active = false by default so the admin can review before activating
 *
 * This is a safe operation: it never modifies the source pack, and the
 * duplicate starts inactive so it doesn't immediately affect retailers.
 */
export async function duplicatePackAction(packId: string, productId: string) {
  const user = await requirePermission('products.edit');
  const supabase = createClient();

  // Fetch the source pack with its tiers.
  //
  // `cost_price` is deliberately NOT part of this select: migration 0025
  // revokes direct column SELECT on products/product_packs from the
  // anon/authenticated roles so a retailer session can never read purchase
  // cost through PostgREST. Admin-only reads go through the SECURITY DEFINER
  // accessors in lib/admin/cost-access.ts, which re-check the role in the
  // database. `/admin/**` is admin/super_admin only (lib/auth/roles.ts), so
  // this call site is already correctly scoped.
  const { data: source, error: fetchError } = await supabase
    .from('product_packs')
    .select('id, product_id, pack_name, units_per_case, base_price, mrp, case_price, barcode, image_url, moq, is_active, sort_order')
    .eq('id', packId)
    .eq('product_id', productId)
    .maybeSingle<{
      id: string;
      product_id: string;
      pack_name: string;
      units_per_case: number;
      base_price: number;
      mrp: number | null;
      case_price: number;
      barcode: string | null;
      image_url: string | null;
      moq: number;
      is_active: boolean;
      sort_order: number;
    }>();

  if (fetchError) throw new Error(fetchError.message);
  if (!source) throw new Error('Pack not found for this product.');

  // Purchase cost of the source pack, so the duplicate carries it forward
  // exactly as before (admin-only accessor, returns null below admin).
  const sourceCostPrice = await loadPackCost(supabase, packId);

  // Create the duplicate.
  const { data: newPack, error: insertError } = await supabase
    .from('product_packs')
    .insert({
      product_id: productId,
      pack_name: `${source.pack_name} (Copy)`,
      pack_sku_code: generatePackSkuCode(productId),
      units_per_case: source.units_per_case,
      base_price: source.base_price,
      mrp: source.mrp,
      cost_price: sourceCostPrice,
      case_price: source.case_price,
      barcode: null, // Don't duplicate barcode (must be unique if set)
      image_url: source.image_url,
      moq: source.moq,
      is_active: false, // Start inactive for review
      sort_order: source.sort_order + 1,
      created_by: user.id,
    } as unknown as never)
    .select('id')
    .maybeSingle<{ id: string }>();

  if (insertError) throw new Error(insertError.message);
  if (!newPack) throw new Error('Failed to create duplicate pack.');

  // Copy pricing tiers from the source.
  const { data: sourceTiers } = await supabase
    .from('product_pricing_tiers')
    .select('min_quantity, max_quantity, price_per_piece, rule_type, label')
    .eq('product_pack_id', packId)
    .eq('is_active', true);

  if (sourceTiers && sourceTiers.length > 0) {
    const tiers = sourceTiers as unknown as { min_quantity: number; max_quantity: number | null; price_per_piece: number; rule_type: string; label: string | null }[];
    const newTiers = tiers.map((tier) => ({
      product_pack_id: newPack.id,
      min_quantity: tier.min_quantity,
      max_quantity: tier.max_quantity,
      price_per_piece: tier.price_per_piece,
      rule_type: tier.rule_type,
      label: tier.label,
      created_by: user.id,
    }));
    await supabase.from('product_pricing_tiers').insert(newTiers as unknown as never);
  }

  revalidatePath(`/admin/products/${productId}`);
}
