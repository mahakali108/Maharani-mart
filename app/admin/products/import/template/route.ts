import { requirePermission } from '@/lib/admin/guard';
import { toCsv, csvStamp } from '@/lib/admin/csv';
import { productCsvTemplate } from '@/lib/admin/product-csv';

/**
 * Downloadable CSV template for the catalog importer.
 *
 * The header is exactly what `analyzeProductCsv` accepts, and the single
 * example row is itself a valid row — so the template can be filled in and
 * re-uploaded without a validation surprise. It contains no real business
 * data: the example values are obviously synthetic ("Example Brand").
 */
export async function GET() {
  await requirePermission('products.create');

  const template = productCsvTemplate();
  const csv = toCsv(template[0]!, template.slice(1));

  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="maharani-product-import-template-${csvStamp(
        new Date().toISOString()
      )}.csv"`,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
