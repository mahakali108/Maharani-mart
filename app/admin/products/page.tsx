import Link from 'next/link';
import { Package, Plus, Search } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { requireUser } from '@/lib/auth/session';
import { can } from '@/lib/permissions/permissions';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { AdminEmptyState } from '@/components/admin/empty-state';
import { ProductRowActions } from '@/components/admin/product-row-actions';

interface ProductRow {
  id: string;
  sku_code: string;
  name: string;
  base_price: number;
  is_active: boolean;
  is_new_launch: boolean;
  brands: { name: string } | null;
  categories: { name: string } | null;
}

interface Option {
  id: string;
  name: string;
}

export default async function ProductsPage({
  searchParams,
}: {
  searchParams: { q?: string; brand?: string; category?: string; status?: string };
}) {
  const user = await requireUser();
  const supabase = createClient();

  const q = searchParams.q?.trim() ?? '';
  const brandFilter = searchParams.brand ?? '';
  const categoryFilter = searchParams.category ?? '';
  const statusFilter = searchParams.status ?? '';

  let query = supabase
    .from('products')
    .select('id, sku_code, name, base_price, is_active, is_new_launch, brands ( name ), categories ( name )')
    .order('created_at', { ascending: false });

  if (q) query = query.or(`name.ilike.%${q}%,sku_code.ilike.%${q}%`);
  if (brandFilter) query = query.eq('brand_id', brandFilter);
  if (categoryFilter) query = query.eq('category_id', categoryFilter);
  if (statusFilter === 'active') query = query.eq('is_active', true);
  if (statusFilter === 'inactive') query = query.eq('is_active', false);

  const [{ data }, { data: brandOptions }, { data: categoryOptions }] = await Promise.all([
    query,
    supabase.from('brands').select('id, name').order('name'),
    supabase.from('categories').select('id, name').order('name'),
  ]);

  const products = (data ?? []) as unknown as ProductRow[];
  const brands = (brandOptions ?? []) as Option[];
  const categories = (categoryOptions ?? []) as Option[];
  const canDelete = can(user.role, 'products.delete');
  const hasFilters = q || brandFilter || categoryFilter || statusFilter;

  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
        <div>
          <h1 className="text-2xl font-semibold text-ink-950">Products</h1>
          <p className="mt-1 text-sm text-ink-500">Your full product catalog. Nothing is visible to retailers until added here.</p>
        </div>
        <Link href="/admin/products/new">
          <Button>
            <Plus className="h-4 w-4" />
            Add product
          </Button>
        </Link>
      </div>

      <Card>
        <form method="get" className="grid grid-cols-1 gap-3 sm:grid-cols-5">
          <div className="relative sm:col-span-2">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
            <Input name="q" defaultValue={q} placeholder="Search name or SKU…" className="pl-9" />
          </div>
          <Select name="brand" defaultValue={brandFilter}>
            <option value="">All brands</option>
            {brands.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </Select>
          <Select name="category" defaultValue={categoryFilter}>
            <option value="">All categories</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
          <Select name="status" defaultValue={statusFilter}>
            <option value="">All statuses</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </Select>
          <div className="flex gap-2 sm:col-span-5">
            <Button type="submit" variant="secondary" size="sm">
              Apply filters
            </Button>
            {hasFilters ? (
              <Link href="/admin/products">
                <Button type="button" variant="ghost" size="sm">
                  Clear
                </Button>
              </Link>
            ) : null}
          </div>
        </form>
      </Card>

      {products.length === 0 ? (
        <AdminEmptyState
          icon={Package}
          title={hasFilters ? 'No products match your filters' : 'No products yet'}
          body={
            hasFilters
              ? 'Try a different search term or clear the filters above.'
              : 'Add your first product to start building the catalog. Retailers will see nothing until products exist here.'
          }
        />
      ) : (
        <Card className="overflow-hidden p-0">
          <table className="w-full text-sm">
            <thead className="border-b border-ink-100 bg-ink-50 text-left text-xs uppercase tracking-wide text-ink-500">
              <tr>
                <th className="px-5 py-3 font-medium">SKU</th>
                <th className="px-5 py-3 font-medium">Name</th>
                <th className="px-5 py-3 font-medium">Brand</th>
                <th className="px-5 py-3 font-medium">Category</th>
                <th className="px-5 py-3 font-medium">Base Price</th>
                <th className="px-5 py-3 font-medium">Status</th>
                <th className="px-5 py-3 font-medium" />
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-100">
              {products.map((p) => (
                <tr key={p.id}>
                  <td className="px-5 py-3 font-mono text-xs text-ink-500">{p.sku_code}</td>
                  <td className="px-5 py-3 font-medium text-ink-900">
                    <Link href={`/admin/products/${p.id}`} className="hover:text-primary-600">
                      {p.name}
                    </Link>
                    {p.is_new_launch ? (
                      <span className="ml-2 rounded-full bg-primary-50 px-2 py-0.5 text-[10px] font-semibold uppercase text-primary-600">
                        New
                      </span>
                    ) : null}
                  </td>
                  <td className="px-5 py-3 text-ink-600">{p.brands?.name ?? '—'}</td>
                  <td className="px-5 py-3 text-ink-600">{p.categories?.name ?? '—'}</td>
                  <td className="px-5 py-3 text-ink-600">₹{p.base_price.toFixed(2)}</td>
                  <td className="px-5 py-3">
                    <ProductRowActions id={p.id} isActive={p.is_active} canDelete={canDelete} />
                  </td>
                  <td className="px-5 py-3 text-right">
                    <Link href={`/admin/products/${p.id}`} className="text-xs font-medium text-primary-600 hover:text-primary-700">
                      Edit
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
    }
