'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { requireUser } from '@/lib/auth/session';
import { can } from '@/lib/permissions/permissions';
import { analyzeProductCsv, describeImportResult, derivedPiecePrice } from '@/lib/admin/product-csv';
import { seedDefaultPackForProduct } from '@/lib/admin/products-actions';

/**
 * CSV catalog import.
 *
 * TWO STAGES, ONE FILE
 * --------------------
 * `mode=preview` analyses the upload and returns every row with its issues so
 * the operator can see exactly what will happen BEFORE anything is written.
 * `mode=import` re-reads the same file from the still-populated input and
 * writes it. Nothing is persisted during preview.
 *
 * ATOMICITY — STATED, NOT PRETENDED
 * ---------------------------------
 * The Supabase JS client has no multi-statement transaction, so a whole-file
 * rollback is not available without a new RPC. What this does instead:
 *   * Every row is validated before ANY row is written, so a file with a bad
 *     row never starts a partial import by accident.
 *   * Each row is written as product + default pack. If the pack write fails,
 *     the just-created product is deleted, so a half-created, unorderable
 *     product cannot be left behind.
 *   * The result reports imported / skipped / failed counts that always add up
 *     to the row count, with a message per failed row. Nothing is silently
 *     ignored.
 *
 * PERMISSIONS
 * -----------
 * Requires `products.create`. RLS still applies to every write, so the action
 * cannot create a product a caller could not create through the form.
 */

/** Upload ceiling. A catalog CSV is text; this only stops an absurd upload. */
const MAX_UPLOAD_BYTES = 2 * 1024 * 1024;

export interface ImportPreviewRow {
  rowNumber: number;
  name: string;
  brand: string;
  category: string;
  gst: string;
  hsn: string;
  barcode: string;
  casePrice: string;
  piecePrice: string | null;
  moq: string;
  valid: boolean;
  issues: string[];
}

export interface ImportPreview {
  rows: ImportPreviewRow[];
  unknownHeaders: string[];
  validCount: number;
  invalidCount: number;
}

export type ImportResult =
  | { stage: 'error'; error: string }
  | { stage: 'preview'; preview: ImportPreview }
  | {
      stage: 'done';
      imported: number;
      skipped: number;
      summary: string;
      failed: { rowNumber: number; message: string }[];
    };

interface NameLookup {
  byName: Map<string, string>;
  inactive: Set<string>;
}

/** Case-insensitive name → id, plus the names that exist but are deactivated. */
async function loadNameLookup(table: 'brands' | 'categories'): Promise<NameLookup> {
  const supabase = createClient();
  const { data } = await supabase
    .from(table)
    .select('id, name, is_active')
    .returns<{ id: string; name: string; is_active: boolean }[]>();
  const byName = new Map<string, string>();
  const inactive = new Set<string>();
  for (const row of data ?? []) {
    byName.set(row.name.trim().toLowerCase(), row.id);
    if (!row.is_active) inactive.add(row.name.trim().toLowerCase());
  }
  return { byName, inactive };
}

async function readUpload(formData: FormData): Promise<{ text: string } | { error: string }> {
  const file = formData.get('file');
  if (!(file instanceof File) || file.size === 0) {
    return { error: 'Choose a CSV file to upload.' };
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return { error: 'That file is larger than 2 MB. Split it into smaller files.' };
  }
  try {
    return { text: await file.text() };
  } catch {
    return { error: 'That file could not be read. Re-export it as UTF-8 CSV and try again.' };
  }
}

export async function importProductsAction(formData: FormData): Promise<ImportResult> {
  const user = await requireUser();
  if (!can(user.role, 'products.create')) {
    return { stage: 'error', error: 'You do not have permission to add products.' };
  }

  const mode = formData.get('mode') === 'import' ? 'import' : 'preview';
  const uploaded = await readUpload(formData);
  if ('error' in uploaded) return { stage: 'error', error: uploaded.error };

  const report = analyzeProductCsv(uploaded.text);
  if (report.fatalErrors.length > 0) {
    return { stage: 'error', error: report.fatalErrors.join(' ') };
  }

  const supabase = createClient();
  const [brands, categories] = await Promise.all([loadNameLookup('brands'), loadNameLookup('categories')]);

  // Resolve brand/category names and check barcodes against the live catalog.
  // An unknown name is a row error, not a silent skip: creating a product with
  // no category would hide it from category browsing.
  const barcodes = report.rows
    .map((row) => row.value?.barcode)
    .filter((barcode): barcode is string => Boolean(barcode));
  const existingBarcodes = new Set<string>();
  if (barcodes.length > 0) {
    for (let index = 0; index < barcodes.length; index += 100) {
      const { data } = await supabase
        .from('products')
        .select('barcode')
        .in('barcode', barcodes.slice(index, index + 100))
        .returns<{ barcode: string | null }[]>();
      for (const row of data ?? []) {
        if (row.barcode) existingBarcodes.add(row.barcode);
      }
    }
  }

  interface PreparedRow {
    rowNumber: number;
    name: string;
    brandId: string | null;
    categoryId: string | null;
    value: NonNullable<(typeof report.rows)[number]['value']>;
    isNewLaunch: boolean;
    issues: string[];
    preview: ImportPreviewRow;
  }

  const prepared: PreparedRow[] = [];

  for (const row of report.rows) {
    const issues = row.issues.map((issue) => `${issue.field}: ${issue.message}`);

    const brandKey = row.brandName.toLowerCase();
    const categoryKey = row.categoryName.toLowerCase();
    let brandId: string | null = null;
    let categoryId: string | null = null;

    if (brandKey) {
      const found = brands.byName.get(brandKey);
      if (!found) issues.push(`brand: “${row.brandName}” does not exist. Create it under Categories & Brands first.`);
      else if (brands.inactive.has(brandKey)) issues.push(`brand: “${row.brandName}” is deactivated.`);
      else brandId = found;
    }
    if (categoryKey) {
      const found = categories.byName.get(categoryKey);
      if (!found)
        issues.push(`category: “${row.categoryName}” does not exist. Create it under Categories & Brands first.`);
      else if (categories.inactive.has(categoryKey)) issues.push(`category: “${row.categoryName}” is deactivated.`);
      else categoryId = found;
    } else {
      issues.push('category: a category is required — products without one are invisible in category browsing.');
    }

    if (row.value?.barcode && existingBarcodes.has(row.value.barcode)) {
      issues.push(`barcode: ${row.value.barcode} is already used by another product in the catalog.`);
    }

    const valid = row.value !== null && issues.length === 0;
    prepared.push({
      rowNumber: row.rowNumber,
      name: row.value?.name ?? row.record.name,
      brandId,
      categoryId,
      // Safe fallback: an invalid row is never written, so the value is only
      // read for rows where `valid` is true.
      value: row.value as PreparedRow['value'],
      isNewLaunch: row.isNewLaunch,
      issues,
      preview: {
        rowNumber: row.rowNumber,
        name: row.value?.name ?? row.record.name,
        brand: row.brandName,
        category: row.categoryName,
        gst: row.record.gst_percent || '0',
        hsn: row.record.hsn_code,
        barcode: row.record.barcode,
        casePrice: row.record.case_price,
        piecePrice: row.value
          ? `₹${derivedPiecePrice(row.value.casePrice, row.value.unitsPerCase).toFixed(2)}`
          : null,
        moq: row.record.moq || '1',
        valid,
        issues,
      },
    });
  }

  const validRows = prepared.filter((row) => row.value && row.issues.length === 0);

  if (mode === 'preview') {
    return {
      stage: 'preview',
      preview: {
        rows: prepared.map((row) => row.preview),
        unknownHeaders: [],
        validCount: validRows.length,
        invalidCount: prepared.length - validRows.length,
      },
    };
  }

  if (validRows.length === 0) {
    return {
      stage: 'error',
      error: 'No rows are valid, so nothing was imported. Fix the reported problems and upload again.',
    };
  }

  const failed: { rowNumber: number; message: string }[] = [];
  let imported = 0;
  const skipped = prepared.length - validRows.length;

  for (const row of validRows) {
    const value = row.value;
    if (!value) continue;

    const { data: created, error } = await supabase
      .from('products')
      .insert({
        name: value.name,
        brand_id: row.brandId,
        category_id: row.categoryId,
        unit: value.unit,
        units_per_case: value.unitsPerCase,
        base_price: value.mrp,
        cost_price: value.costPrice,
        gst_percent: value.gstPercent,
        hsn_code: value.hsnCode,
        barcode: value.barcode,
        lead_time_days: value.leadTimeDays,
        is_new_launch: row.isNewLaunch,
        created_by: user.id,
      } as never)
      .select('id')
      .maybeSingle<{ id: string }>();

    if (error || !created) {
      failed.push({
        rowNumber: row.rowNumber,
        message: error?.message.includes('duplicate')
          ? `barcode ${value.barcode} is already in the catalog`
          : (error?.message ?? 'the product could not be created'),
      });
      continue;
    }

    // A product with no pack and no tiers shows in the catalog but cannot be
    // ordered, which is worse than a rejected row — so roll this one row back.
    try {
      await seedDefaultPackForProduct(supabase, created.id, user, {
        unit: value.unit,
        unitsPerCase: value.unitsPerCase,
        basePrice: value.mrp,
        costPrice: value.costPrice,
        casePrice: value.casePrice,
        barcode: value.barcode,
        moq: value.moq,
      });
      const { count } = await supabase
        .from('product_packs')
        .select('id', { count: 'exact', head: true })
        .eq('product_id', created.id);
      if (!count) {
        await supabase.from('products').delete().eq('id', created.id);
        failed.push({ rowNumber: row.rowNumber, message: 'the default variant could not be created' });
        continue;
      }
    } catch (err) {
      await supabase.from('products').delete().eq('id', created.id);
      failed.push({
        rowNumber: row.rowNumber,
        message: err instanceof Error ? err.message : 'the default variant could not be created',
      });
      continue;
    }

    imported += 1;
  }

  revalidatePath('/admin/products');
  revalidatePath('/retailer/catalog');
  revalidatePath('/retailer/home');

  return {
    stage: 'done',
    imported,
    skipped,
    failed,
    summary: describeImportResult({ attempted: prepared.length, imported, skipped, failedRows: failed }),
  };
}
