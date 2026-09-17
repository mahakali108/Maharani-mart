import Link from 'next/link';
import { ArrowLeft, Download } from 'lucide-react';
import { requireUser } from '@/lib/auth/session';
import { can } from '@/lib/permissions/permissions';
import { createClient } from '@/lib/supabase/server';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ProductImportPanel } from '@/components/admin/product-import-panel';
import { PRODUCT_CSV_COLUMNS } from '@/lib/admin/product-csv';

export default async function ImportProductsPage() {
  const user = await requireUser();
  const supabase = createClient();

  const [{ data: brandData }, { data: categoryData }] = await Promise.all([
    supabase.from('brands').select('name').order('name').returns<{ name: string }[]>(),
    supabase.from('categories').select('name').order('name').returns<{ name: string }[]>(),
  ]);

  const canImport = can(user.role, 'products.create');

  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
        <div>
          <Link
            href="/admin/products"
            className="mb-1 inline-flex items-center gap-1 text-xs font-medium text-ink-500 hover:text-ink-800"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> Back to products
          </Link>
          <h1 className="text-2xl font-semibold text-ink-950">Import products from CSV</h1>
          <p className="mt-1 text-sm text-ink-500">
            Check a file first — nothing is written until you confirm the preview.
          </p>
        </div>
        <Link href="/admin/products/import/template">
          <Button variant="outline">
            <Download className="h-4 w-4" /> Download template
          </Button>
        </Link>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Before you upload</CardTitle>
        </CardHeader>
        <ul className="list-disc space-y-1.5 pl-5 text-sm text-ink-600">
          <li>
            Columns: <span className="font-mono text-xs">{PRODUCT_CSV_COLUMNS.join(', ')}</span>. An unrecognised
            column stops the import rather than being quietly dropped.
          </li>
          <li>
            <span className="font-semibold">brand</span> and <span className="font-semibold">category</span> are names,
            not ids, and must already exist. Brands: {(brandData ?? []).length || 'none yet'} · Categories:{' '}
            {(categoryData ?? []).length || 'none yet'}.
          </li>
          <li>
            <span className="font-semibold">mrp</span> and <span className="font-semibold">cost_price</span> are per
            piece. <span className="font-semibold">case_price</span> is the GST-inclusive price of one full case — the
            per-piece selling price is derived from it.
          </li>
          <li>GST must be a statutory slab (0, 0.25, 3, 5, 12, 18 or 28). HSN must be 2, 4, 6 or 8 digits.</li>
          <li>
            Each imported product also gets one default variant with its quantity tiers, so it is orderable
            immediately.
          </li>
        </ul>
      </Card>

      {canImport ? (
        <ProductImportPanel />
      ) : (
        <Card>
          <p className="text-sm text-ink-600">
            Your role can view the catalog but not add products, so the importer is not available to you.
          </p>
        </Card>
      )}
    </div>
  );
}
