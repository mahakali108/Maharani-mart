import Link from 'next/link';
import { ChevronRight, Tag, Tags } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { loadBrandCounts, loadCategoryCounts } from '@/lib/admin/taxonomy-data';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

/**
 * Categories & Brands hub. The lists themselves live at
 * /admin/catalog/categories and /admin/catalog/brands (search, status filter,
 * pagination); this page is the entry point with live counts so an operator
 * can see the shape of the catalog before drilling in.
 */
export default async function CatalogPage() {
  const supabase = createClient();

  const [categoryCounts, brandCounts] = await Promise.all([
    loadCategoryCounts(supabase),
    loadBrandCounts(supabase),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-ink-950">Categories &amp; Brands</h1>
        <p className="mt-1 text-sm text-ink-500">
          Organize your catalog. Products are assigned a brand and category when created.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Card className="p-6">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary-50 text-primary-600">
                <Tags className="h-5 w-5" />
              </span>
              <div>
                <h2 className="text-base font-semibold text-ink-950">Categories</h2>
                <p className="mt-0.5 text-sm text-ink-500">
                  {categoryCounts.active} active of {categoryCounts.total} total
                </p>
              </div>
            </div>
          </div>
          <p className="mt-4 text-sm text-ink-500">
            The aisles of your catalog, with parent/child grouping. Products need an active category to appear
            correctly in the retailer catalog.
          </p>
          <Link href="/admin/catalog/categories" className="mt-4 inline-flex">
            <Button variant="outline" size="sm">
              Manage categories
              <ChevronRight className="h-4 w-4" />
            </Button>
          </Link>
        </Card>

        <Card className="p-6">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary-50 text-primary-600">
                <Tag className="h-5 w-5" />
              </span>
              <div>
                <h2 className="text-base font-semibold text-ink-950">Brands</h2>
                <p className="mt-0.5 text-sm text-ink-500">
                  {brandCounts.active} active of {brandCounts.total} total
                </p>
              </div>
            </div>
          </div>
          <p className="mt-4 text-sm text-ink-500">
            The brands retailers can filter the catalog by. Products can optionally be linked to one.
          </p>
          <Link href="/admin/catalog/brands" className="mt-4 inline-flex">
            <Button variant="outline" size="sm">
              Manage brands
              <ChevronRight className="h-4 w-4" />
            </Button>
          </Link>
        </Card>
      </div>
    </div>
  );
}
