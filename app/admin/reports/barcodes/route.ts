import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { requireUser } from '@/lib/auth/session';
import { can } from '@/lib/permissions/permissions';
import { toCsv, csvStamp, type CsvCell } from '@/lib/admin/csv';

/**
 * Barcode/SKU label data export (CSV) for label printing: one row per
 * sellable pack plus the parent product row. Only products/packs that
 * actually carry a barcode or SKU are useful for labels, but every active
 * row is included so the shop can print "no barcode" placeholders too.
 * RLS-scoped through the caller's session.
 */
export async function GET() {
  const user = await requireUser();
  if (!can(user.role, 'products.view') || !can(user.role, 'reports.view.all')) {
    return NextResponse.json({ error: 'You do not have permission to export label data.' }, { status: 403 });
  }

  const supabase = createClient();

  const [{ data: products }, { data: packs }] = await Promise.all([
    supabase
      .from('products')
      .select('id, name, sku_code, barcode, unit, is_active')
      .order('name')
      .returns<
        { id: string; name: string; sku_code: string | null; barcode: string | null; unit: string; is_active: boolean }[]
      >(),
    supabase
      .from('product_packs')
      .select('id, product_id, pack_name, pack_sku_code, barcode, is_active, products ( name )')
      .order('pack_name')
      .returns<
        {
          id: string;
          product_id: string;
          pack_name: string;
          pack_sku_code: string | null;
          barcode: string | null;
          is_active: boolean;
          products: { name: string } | null;
        }[]
      >(),
  ]);

  const stamp = csvStamp(new Date().toISOString());
  const csv = toCsv(
    ['Level', 'Product', 'Pack', 'SKU', 'Barcode', 'Active'],
    [
      ...(products ?? []).map(
        (p): CsvCell[] => ['Product', p.name, '', p.sku_code ?? '', p.barcode ?? '', p.is_active]
      ),
      ...(packs ?? []).map(
        (k): CsvCell[] => ['Pack', k.products?.name ?? '', k.pack_name, k.pack_sku_code ?? '', k.barcode ?? '', k.is_active]
      ),
    ]
  );

  return new NextResponse(csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="maharani-barcodes-${stamp}.csv"`,
      'Cache-Control': 'no-store',
    },
  });
}
