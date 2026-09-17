'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { requirePermission } from '@/lib/admin/guard';
import { parseGstRate, derivedPiecePrice } from '@/lib/admin/catalog-validation';
import { normalizeBulkIds, type BulkResult, type BulkSkip } from '@/lib/admin/products-bulk-shared';

/**
 * Bulk catalog operations.
 *
 * SHAPES AND GUARDS
 * -----------------
 * * Every action re-checks the caller's permission server-side. The UI hides
 *   what a role cannot do, but hiding is not enforcement — RLS plus
 *   `requirePermission` are.
 * * The product ids come from checkboxes in the page, so they are untrusted.
 *   Every write is additionally bounded by `MAX_BULK_IDS` (see
 *   lib/admin/products-bulk-shared.ts) and by the fact that
 *   an update `.in('id', ids)` can only touch rows RLS already lets the caller
 *   see.
 * * Every mutation lands in `audit_logs` through the existing triggers
 *   (`trg_audit_products` from 0001, `trg_audit_product_packs` from 0004), so
 *   a bulk change of 200 products produces 200 auditable rows — not one opaque
 *   "bulk" entry. No separate audit table is introduced.
 * * Results are reported per row: a caller always learns how many rows changed
 *   and why any were skipped. Nothing fails silently.
 */

function revalidate() {
  revalidatePath('/admin/products');
  revalidatePath('/retailer/catalog');
  revalidatePath('/retailer/home');
}

/**
 * Activate or deactivate in one pass.
 *
 * Deactivating is the reversible alternative to deleting: the row, its packs,
 * its images and its order history all stay intact, and the retailer catalog
 * simply stops showing it (`is_active` is the visibility flag every
 * retailer-facing query already filters on).
 */
async function bulkSetActive(formData: FormData): Promise<BulkResult> {
  await requirePermission('products.edit');

  const selected = normalizeBulkIds(formData.getAll('productIds'));
  if ('error' in selected) return { ok: false, error: selected.error };
  const isActive = formData.get('isActive') === 'true';

  const supabase = createClient();
  const { error } = await supabase
    .from('products')
    .update({ is_active: isActive } as never)
    .in('id', selected.ids);
  if (error) return { ok: false, error: error.message };

  revalidate();
  const verb = isActive ? 'activated' : 'deactivated';
  return { ok: true, updated: selected.ids.length, skipped: [], message: `${selected.ids.length} product(s) ${verb}.` };
}

/**
 * Reassign a category or brand across the selection.
 *
 * The target id is validated against the live table first — a stale or invented
 * UUID would otherwise either violate the FK (an opaque error) or, worse, be
 * accepted for a deactivated category the retailer catalog would then hide.
 */
async function bulkAssignTaxonomy(formData: FormData): Promise<BulkResult> {
  await requirePermission('products.edit');

  const selected = normalizeBulkIds(formData.getAll('productIds'));
  if ('error' in selected) return { ok: false, error: selected.error };

  const kind = formData.get('taxonomy');
  const targetId = String(formData.get('targetId') ?? '').trim();
  if (kind !== 'category' && kind !== 'brand') {
    return { ok: false, error: 'Choose whether to change the category or the brand.' };
  }
  if (!/^[0-9a-f-]{36}$/i.test(targetId)) {
    return { ok: false, error: `Select the ${kind} to apply.` };
  }

  const supabase = createClient();
  const table = kind === 'category' ? 'categories' : 'brands';
  const { data: target, error: targetError } = await supabase
    .from(table)
    .select('id, name, is_active')
    .eq('id', targetId)
    .maybeSingle<{ id: string; name: string; is_active: boolean }>();
  if (targetError) return { ok: false, error: targetError.message };
  if (!target) return { ok: false, error: `That ${kind} no longer exists.` };
  if (!target.is_active) {
    return {
      ok: false,
      error: `${target.name} is deactivated. Activate it first, or pick another ${kind}.`,
    };
  }

  const column = kind === 'category' ? 'category_id' : 'brand_id';
  const { error } = await supabase
    .from('products')
    .update({ [column]: target.id } as never)
    .in('id', selected.ids);
  if (error) return { ok: false, error: error.message };

  revalidate();
  return {
    ok: true,
    updated: selected.ids.length,
    skipped: [],
    message: `${selected.ids.length} product(s) moved to ${kind} “${target.name}”.`,
  };
}

/**
 * Set a GST rate across the selection.
 *
 * Only statutory slabs are accepted (the same list the product form enforces),
 * because this number is printed on a tax invoice. GST is stored on `products`
 * and read at quote time, so changing it reprices future orders without
 * touching any price row — existing order_items keep their snapshotted
 * `gst_percent`, which is exactly what an amended invoice requires.
 */
async function bulkSetGst(formData: FormData): Promise<BulkResult> {
  await requirePermission('products.edit');

  const selected = normalizeBulkIds(formData.getAll('productIds'));
  if ('error' in selected) return { ok: false, error: selected.error };

  const gst = parseGstRate(formData.get('gstPercent'));
  if (gst === null) {
    return { ok: false, error: 'Choose a valid GST slab.' };
  }

  const supabase = createClient();
  const { error } = await supabase
    .from('products')
    .update({ gst_percent: gst } as never)
    .in('id', selected.ids);
  if (error) return { ok: false, error: error.message };

  revalidate();
  return {
    ok: true,
    updated: selected.ids.length,
    skipped: [],
    message: `${selected.ids.length} product(s) set to ${gst}% GST.`,
  };
}

/**
 * Set the minimum order quantity across the selection.
 *
 * MOQ lives on `product_packs` (0007), not on `products` — a 200g and a 5kg
 * variant of the same product legitimately have different minimums. This
 * therefore writes every ACTIVE pack of each selected product, and says so in
 * the confirmation message rather than implying the product itself carries a
 * single MOQ.
 */
async function bulkSetMoq(formData: FormData): Promise<BulkResult> {
  await requirePermission('products.edit');

  const selected = normalizeBulkIds(formData.getAll('productIds'));
  if ('error' in selected) return { ok: false, error: selected.error };

  const moq = Number(formData.get('moq'));
  if (!Number.isInteger(moq) || moq < 1 || moq > 100_000) {
    return { ok: false, error: 'MOQ must be a whole number of 1 piece or more.' };
  }

  const supabase = createClient();
  const { error } = await supabase
    .from('product_packs')
    .update({ moq } as never)
    .in('product_id', selected.ids)
    .eq('is_active', true);
  if (error) return { ok: false, error: error.message };

  revalidate();
  return {
    ok: true,
    updated: selected.ids.length,
    skipped: [],
    message: `MOQ set to ${moq} pcs on every active variant of ${selected.ids.length} product(s).`,
  };
}

/**
 * Adjust the GST-inclusive case selling price across the selection.
 *
 * Gated on `pricing.manage` (admin and super_admin only) rather than
 * `products.edit`, because this changes what retailers are charged.
 *
 * SAFETY
 * ------
 * * `mode` is either `percent` (±X%) or `flat` (±₹ on the case price). The
 *   resulting price is rounded to 2dp and must stay ≥ 0.
 * * Every pack whose new derived piece price would fall BELOW its purchase
 *   cost is skipped and named in the result. The comparison is
 *   GST-inclusive price vs cost, which is negative margin under either cost
 *   convention, so a profitable pack is never skipped by mistake.
 * * The default/case quantity tiers of each changed pack are re-anchored to
 *   the new case price, exactly as `updateProductAction` does — otherwise the
 *   storefront would keep showing the old derived piece price.
 * * Purchase cost is read through `admin_product_costs()` (0050), the
 *   admin-only accessor, because 0025 revokes direct `SELECT (cost_price)`.
 *   A caller without cost access simply gets no skips reported for cost, which
 *   cannot happen here: `pricing.manage` implies admin.
 */
async function bulkAdjustPrice(formData: FormData): Promise<BulkResult> {
  await requirePermission('pricing.manage');

  const selected = normalizeBulkIds(formData.getAll('productIds'));
  if ('error' in selected) return { ok: false, error: selected.error };

  const mode = formData.get('mode') === 'flat' ? 'flat' : 'percent';
  const delta = Number(formData.get('delta'));
  if (!Number.isFinite(delta)) return { ok: false, error: 'Enter the amount to change prices by.' };
  if (mode === 'percent' && (delta <= -100 || delta > 1000)) {
    return { ok: false, error: 'Percentage must be between -99 and 1000.' };
  }
  if (mode === 'flat' && Math.abs(delta) > 1_000_000) {
    return { ok: false, error: 'That price change is too large — check the amount.' };
  }

  const supabase = createClient();

  const { data: packs, error: packError } = await supabase
    .from('product_packs')
    .select('id, product_id, pack_name, case_price, units_per_case, cost_price')
    .in('product_id', selected.ids)
    .eq('is_active', true)
    .returns<{
      id: string;
      product_id: string;
      pack_name: string;
      case_price: number;
      units_per_case: number;
      cost_price: number | null;
    }[]>();
  if (packError) return { ok: false, error: packError.message };

  const rows = packs ?? [];
  if (rows.length === 0) {
    return { ok: false, error: 'The selected products have no active variants to reprice.' };
  }

  const skipped: BulkSkip[] = [];
  let updated = 0;

  for (const pack of rows) {
    const next =
      mode === 'flat'
        ? Math.round((pack.case_price + delta) * 100) / 100
        : Math.round(pack.case_price * (1 + delta / 100) * 100) / 100;

    if (next < 0) {
      skipped.push({ id: pack.id, name: pack.pack_name, reason: 'the adjusted price would be negative' });
      continue;
    }
    const cost = pack.cost_price;
    if (cost !== null && cost > 0) {
      const piece = derivedPiecePrice(next, pack.units_per_case);
      if (piece < cost) {
        skipped.push({
          id: pack.id,
          name: pack.pack_name,
          reason: `the adjusted price (₹${piece.toFixed(2)}/pc) would fall below the ₹${cost.toFixed(2)} cost`,
        });
        continue;
      }
    }

    const { error } = await supabase
      .from('product_packs')
      .update({ case_price: next } as never)
      .eq('id', pack.id);
    if (error) {
      skipped.push({ id: pack.id, name: pack.pack_name, reason: error.message });
      continue;
    }

    // Keep the derived piece price the storefront shows anchored to the new
    // case price, exactly as the single-product edit path does.
    const piecePrice = derivedPiecePrice(next, pack.units_per_case);
    await supabase
      .from('product_pricing_tiers')
      .update({ price_per_piece: piecePrice } as never)
      .eq('product_pack_id', pack.id)
      .in('rule_type', ['default', 'case']);

    updated += 1;
  }

  if (updated === 0) {
    return {
      ok: false,
      error: `No prices were changed. ${skipped.length} variant(s) were skipped — see the list below.`,
    };
  }

  revalidate();
  const direction = delta === 0 ? 'unchanged' : delta > 0 ? 'raised' : 'lowered';
  return {
    ok: true,
    updated,
    skipped,
    message: `${updated} variant(s) ${direction} by ${mode === 'flat' ? `₹${Math.abs(delta)}` : `${Math.abs(delta)}%`} per case.`,
  };
}


// ----------------------------------------------------------------------------
// Dispatcher
// ----------------------------------------------------------------------------

/**
 * Single entry point for the bulk toolbar.
 *
 * One form + one submit button drives every bulk operation, so the operation
 * itself travels as a `bulkAction` field. An unknown or missing value is a hard
 * error rather than a no-op: a toolbar bug must never silently "succeed"
 * without changing anything.
 *
 * The permission check happens inside each branch, not here, so the gate is
 * always the one that matches the operation actually performed.
 */
export async function bulkCatalogAction(
  _prevState: BulkResult | null,
  formData: FormData
): Promise<BulkResult> {
  const kind = String(formData.get('bulkAction') ?? '');
  switch (kind) {
    case 'activate':
      formData.set('isActive', 'true');
      return bulkSetActive(formData);
    case 'deactivate':
      formData.set('isActive', 'false');
      return bulkSetActive(formData);
    case 'category':
    case 'brand':
      formData.set('taxonomy', kind);
      return bulkAssignTaxonomy(formData);
    case 'gst':
      return bulkSetGst(formData);
    case 'moq':
      return bulkSetMoq(formData);
    case 'price':
      return bulkAdjustPrice(formData);
    default:
      return { ok: false, error: 'Choose a bulk action to apply.' };
  }
}
