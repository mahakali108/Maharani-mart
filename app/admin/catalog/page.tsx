import { Tag, Tags, Search } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { BrandForm } from '@/components/admin/brand-form';
import { BrandRowActions } from '@/components/admin/brand-row-actions';
import { CategoryForm } from '@/components/admin/category-form';
import { CategoryRowActions } from '@/components/admin/category-row-actions';
import { AdminEmptyState } from '@/components/admin/empty-state';

interface BrandRow {
  id: string;
  name: string;
  is_active: boolean;
}

interface CategoryRow {
  id: string;
  name: string;
  is_active: boolean;
  parent_id: string | null;
}

export default async function CatalogPage({
  searchParams,
}: {
  searchParams: { brandQ?: string; categoryQ?: string };
}) {
  const supabase = createClient();
  const brandQ = searchParams.brandQ?.trim() ?? '';
  const categoryQ = searchParams.categoryQ?.trim() ?? '';

  const [{ data: brandData }, { data: categoryData }] = await Promise.all([
    supabase.from('brands').select('id, name, is_active').order('name'),
    supabase.from('categories').select('id, name, is_active, parent_id').order('name'),
  ]);

  const allBrands = (brandData ?? []) as BrandRow[];
  const allCategories = (categoryData ?? []) as CategoryRow[];
  const categoryById = new Map(allCategories.map((c) => [c.id, c]));

  const brands = brandQ ? allBrands.filter((b) => b.name.toLowerCase().includes(brandQ.toLowerCase())) : allBrands;
  const categories = categoryQ
    ? allCategories.filter((c) => c.name.toLowerCase().includes(categoryQ.toLowerCase()))
    : allCategories;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold text-ink-950">Categories &amp; Brands</h1>
        <p className="mt-1 text-sm text-ink-500">
          Organize your catalog. Products are assigned a brand and category when created.
        </p>
      </div>

      <section className="space-y-4">
        <div className="flex items-center gap-2">
          <Tag className="h-4 w-4 text-primary-600" />
          <h2 className="text-sm font-semibold text-ink-800">Brands</h2>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Add a new brand</CardTitle>
          </CardHeader>
          <BrandForm />
        </Card>

        <form method="get" className="flex gap-2">
          <input type="hidden" name="categoryQ" value={categoryQ} />
          <div className="relative flex-1 sm:max-w-xs">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
            <Input name="brandQ" defaultValue={brandQ} placeholder="Search brands…" className="pl-9" />
          </div>
          <Button type="submit" variant="outline" size="sm">
            Search
          </Button>
        </form>

        {brands.length === 0 ? (
          <AdminEmptyState
            icon={Tag}
            title="No brands yet"
            body="Add your first brand above — products can optionally be linked to one."
          />
        ) : (
          <Card className="overflow-hidden p-0">
            <table className="w-full text-sm">
              <thead className="border-b border-ink-100 bg-ink-50 text-left text-xs uppercase tracking-wide text-ink-500">
                <tr>
                  <th className="px-5 py-3 font-medium">Name</th>
                  <th className="px-5 py-3 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100">
                {brands.map((brand) => (
                  <tr key={brand.id}>
                    <td className="px-5 py-3 font-medium text-ink-900">{brand.name}</td>
                    <td className="px-5 py-3">
                      <BrandRowActions id={brand.id} isActive={brand.is_active} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        )}
      </section>

      <section className="space-y-4">
        <div className="flex items-center gap-2">
          <Tags className="h-4 w-4 text-primary-600" />
          <h2 className="text-sm font-semibold text-ink-800">Categories</h2>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Add a new category</CardTitle>
          </CardHeader>
          <CategoryForm categories={allCategories.map((c) => ({ id: c.id, name: c.name }))} />
        </Card>

        <form method="get" className="flex gap-2">
          <input type="hidden" name="brandQ" value={brandQ} />
          <div className="relative flex-1 sm:max-w-xs">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
            <Input name="categoryQ" defaultValue={categoryQ} placeholder="Search categories…" className="pl-9" />
          </div>
          <Button type="submit" variant="outline" size="sm">
            Search
          </Button>
        </form>

        {categories.length === 0 ? (
          <AdminEmptyState
            icon={Tags}
            title="No categories yet"
            body="Add your first category above — products need a category to appear correctly in the retailer catalog."
          />
        ) : (
          <Card className="overflow-hidden p-0">
            <table className="w-full text-sm">
              <thead className="border-b border-ink-100 bg-ink-50 text-left text-xs uppercase tracking-wide text-ink-500">
                <tr>
                  <th className="px-5 py-3 font-medium">Name</th>
                  <th className="px-5 py-3 font-medium">Parent</th>
                  <th className="px-5 py-3 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100">
                {categories.map((cat) => (
                  <tr key={cat.id}>
                    <td className="px-5 py-3 font-medium text-ink-900">{cat.name}</td>
                    <td className="px-5 py-3 text-ink-600">
                      {cat.parent_id ? categoryById.get(cat.parent_id)?.name ?? '—' : '— Top level —'}
                    </td>
                    <td className="px-5 py-3">
                      <CategoryRowActions id={cat.id} isActive={cat.is_active} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        )}
      </section>
    </div>
  );
      }
