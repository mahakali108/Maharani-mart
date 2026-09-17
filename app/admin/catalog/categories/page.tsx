import Link from 'next/link';
import { Tags } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { requireUser } from '@/lib/auth/session';
import { can } from '@/lib/permissions/permissions';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { ADMIN_STATUS_FILTERS } from '@/lib/admin/catalog-query';
import {
  BRANDS_LIST_PATH,
  CATEGORIES_LIST_PATH,
  hasMasterListFilters,
  masterListHref,
  masterPageRange,
  masterTotalPages,
  parseMasterListParams,
} from '@/lib/admin/master-data-query';
import { CategoryForm } from '@/components/admin/category-form';
import { CategoryRowActions } from '@/components/admin/category-row-actions';
import { AdminEmptyState } from '@/components/admin/empty-state';

interface CategoryOption {
  id: string;
  name: string;
}

interface CategoryListRow {
  id: string;
  name: string;
  parent_id: string | null;
  sort_order: number;
  is_active: boolean;
  products: { count: number }[] | null;
}

/**
 * Admin categories list (Phase 7).
 *
 * Server-side search (`ilike` on name), an is_active status filter and DB
 * pagination — the same bounded-list contract the admin product list has
 * (lib/admin/catalog-query.ts), instead of the old page's load-everything
 * approach. `sort_order` is a real column (0001) that 0050 indexed for
 * exactly this list, and the retailer directory orders by it, so it is
 * editable here rather than invented.
 */
export default async function AdminCategoriesPage({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const user = await requireUser();
  const params = parseMasterListParams(searchParams);
  const canDelete = can(user.role, 'master_data.delete');
  const supabase = createClient();

  // Options for the create form's parent select and for resolving parent
  // names on the page rows. Categories are master data (a small table); the
  // previous page loaded every column of every row, this loads two.
  const { data: optionData, error: optionError } = await supabase
    .from('categories')
    .select('id, name')
    .order('name')
    .returns<CategoryOption[]>();
  if (optionError) throw new Error(optionError.message);
  const options = optionData ?? [];
  const nameById = new Map(options.map((option) => [option.id, option.name]));

  let query = supabase
    .from('categories')
    .select('id, name, parent_id, sort_order, is_active, products(count)', { count: 'exact' });
  if (params.q) query = query.ilike('name', `%${params.q}%`);
  if (params.status === 'active') query = query.eq('is_active', true);
  if (params.status === 'inactive') query = query.eq('is_active', false);

  const { from, to } = masterPageRange(params.page);
  const { data, count, error } = await query
    .order('sort_order', { ascending: true })
    .order('name', { ascending: true })
    .range(from, to)
    .returns<CategoryListRow[]>();
  if (error) throw new Error(error.message);

  const rows = data ?? [];
  const total = count ?? 0;
  const totalPages = masterTotalPages(total);
  const hasFilters = hasMasterListFilters(params);

  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
        <div>
          <h1 className="text-2xl font-semibold text-ink-950">Categories</h1>
          <p className="mt-1 text-sm text-ink-500">
            Product categories shown in the retailer catalog. Lower sort order appears first.
          </p>
        </div>
        <div className="flex gap-1 rounded-xl border border-ink-100 bg-white p-1">
          <span className="rounded-lg bg-primary-600 px-3 py-1.5 text-sm font-medium text-white">Categories</span>
          <Link
            href={BRANDS_LIST_PATH}
            className="rounded-lg px-3 py-1.5 text-sm font-medium text-ink-600 hover:bg-ink-50 hover:text-ink-900"
          >
            Brands
          </Link>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Add a new category</CardTitle>
        </CardHeader>
        <CategoryForm categories={options} />
      </Card>

      <Card>
        <form method="get" className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="relative sm:col-span-2">
            <Input name="q" defaultValue={params.q} placeholder="Search categories by name…" />
          </div>
          <Select name="status" defaultValue={params.status}>
            {ADMIN_STATUS_FILTERS.map((status) => (
              <option key={status} value={status}>
                {status === 'all' ? 'Any status' : status === 'active' ? 'Active' : 'Inactive'}
              </option>
            ))}
          </Select>
          <div className="flex flex-wrap items-center gap-2 sm:col-span-3">
            <Button type="submit" variant="secondary" size="sm">
              Apply
            </Button>
            {hasFilters ? (
              <Link href={CATEGORIES_LIST_PATH}>
                <Button type="button" variant="ghost" size="sm">
                  Clear filters
                </Button>
              </Link>
            ) : null}
          </div>
        </form>
      </Card>

      {rows.length === 0 ? (
        <AdminEmptyState
          icon={Tags}
          title={hasFilters ? 'No categories match your filters' : 'No categories yet'}
          body={
            hasFilters
              ? 'Try a different search term or status, or clear the filters above.'
              : 'Add your first category above — products need a category to appear correctly in the retailer catalog.'
          }
        />
      ) : (
        <>
          {/* ==================== DESKTOP: TABLE (lg and up) ==================== */}
          <Card className="hidden overflow-hidden p-0 lg:block">
            <div className="table-scroll">
              <table className="w-full min-w-[720px] text-sm">
                <thead className="border-b border-ink-100 bg-ink-50 text-left text-xs uppercase tracking-wide text-ink-500">
                  <tr>
                    <th className="px-5 py-3 font-medium">Name</th>
                    <th className="px-5 py-3 font-medium">Parent</th>
                    <th className="px-5 py-3 font-medium">Sort</th>
                    <th className="px-5 py-3 font-medium">Products</th>
                    <th className="px-5 py-3 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-ink-100">
                  {rows.map((row) => (
                    <tr key={row.id}>
                      <td className="px-5 py-3">
                        <Link
                          href={`/admin/catalog/categories/${row.id}`}
                          className="font-medium text-ink-900 hover:text-primary-600"
                        >
                          {row.name}
                        </Link>
                      </td>
                      <td className="px-5 py-3 text-ink-600">
                        {row.parent_id ? nameById.get(row.parent_id) ?? '—' : '— Top level —'}
                      </td>
                      <td className="px-5 py-3 text-ink-600">{row.sort_order}</td>
                      <td className="px-5 py-3 text-ink-600" title="Includes inactive products">
                        {row.products?.[0]?.count ?? 0}
                      </td>
                      <td className="px-5 py-3">
                        <CategoryRowActions id={row.id} name={row.name} isActive={row.is_active} canDelete={canDelete} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          {/* ==================== MOBILE / TABLET: CARDS (below lg) ==================== */}
          <ul className="space-y-2.5 lg:hidden">
            {rows.map((row) => (
              <li
                key={row.id}
                className="rounded-xl border border-ink-100 bg-white p-3.5 shadow-[0_1px_2px_rgba(15,23,42,0.04)]"
              >
                <div className="flex items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <Link
                      href={`/admin/catalog/categories/${row.id}`}
                      className="block truncate text-sm font-semibold text-ink-900 hover:text-primary-600"
                    >
                      {row.name}
                    </Link>
                    <p className="mt-0.5 truncate text-xs text-ink-500">
                      {row.parent_id ? nameById.get(row.parent_id) ?? 'Unknown parent' : 'Top level'} · sort{' '}
                      {row.sort_order} · {row.products?.[0]?.count ?? 0} product
                      {(row.products?.[0]?.count ?? 0) === 1 ? '' : 's'}
                    </p>
                  </div>
                </div>
                <div className="mt-3 border-t border-ink-100 pt-2.5">
                  <CategoryRowActions id={row.id} name={row.name} isActive={row.is_active} canDelete={canDelete} />
                </div>
              </li>
            ))}
          </ul>

          {totalPages > 1 ? (
            <div className="flex items-center justify-center gap-2">
              {params.page > 1 ? (
                <Link href={masterListHref('categories', params, { page: params.page - 1 })}>
                  <Button size="sm" variant="outline">
                    Previous
                  </Button>
                </Link>
              ) : null}
              <span className="text-xs text-ink-400">
                Page {params.page} of {totalPages} · {total} categor{total === 1 ? 'y' : 'ies'}
              </span>
              {params.page < totalPages ? (
                <Link href={masterListHref('categories', params, { page: params.page + 1 })}>
                  <Button size="sm" variant="outline">
                    Next
                  </Button>
                </Link>
              ) : null}
            </div>
          ) : (
            <p className="text-center text-xs text-ink-400">
              {total} categor{total === 1 ? 'y' : 'ies'}
            </p>
          )}
        </>
      )}
    </div>
  );
}
