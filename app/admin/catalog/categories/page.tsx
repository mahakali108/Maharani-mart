import Link from 'next/link';
import { Tags } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { requireUser } from '@/lib/auth/session';
import { can } from '@/lib/permissions/permissions';
import { ADMIN_STATUS_FILTERS, type AdminStatusFilter } from '@/lib/admin/catalog-query';
import {
  TAXONOMY_SORTS,
  TAXONOMY_SORT_LABELS,
  countTaxonomyFilters,
  hasTaxonomyFilters,
  parseTaxonomyParams,
  taxonomyPageHref,
} from '@/lib/admin/taxonomy-query';
import { loadAdminCategoriesPage } from '@/lib/admin/taxonomy-data';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { CategoryForm } from '@/components/admin/category-form';
import { CategoryRowActions } from '@/components/admin/category-row-actions';
import { AdminEmptyState } from '@/components/admin/empty-state';

interface Option {
  id: string;
  name: string;
}

const STATUS_LABELS: Record<AdminStatusFilter, string> = {
  all: 'Any status',
  active: 'Active',
  inactive: 'Inactive',
};

/**
 * Admin category list.
 *
 * Search, status filter, sort and pagination are all plain `categories`
 * columns, so the whole query — including the exact total — is answered by one
 * DB-paginated request (see lib/admin/taxonomy-data.ts). The product count per
 * row is the real link count from `products.category_id`, which is what an
 * operator needs before deactivating or deleting a category.
 */
export default async function CategoriesPage({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const user = await requireUser();
  const canManage = can(user.role, 'master_data.manage');
  const params = parseTaxonomyParams(searchParams);
  const supabase = createClient();

  const [{ rows, total, totalPages }, { data: categoryOptions }] = await Promise.all([
    loadAdminCategoriesPage(supabase, params),
    // Parent options for the add form — the same bounded-in-practice options
    // list every other admin surface (e.g. the product form) loads.
    canManage
      ? supabase.from('categories').select('id, name').order('sort_order').order('name').returns<Option[]>()
      : Promise.resolve({ data: null }),
  ]);

  const activeFilters = hasTaxonomyFilters(params);
  const filterCount = countTaxonomyFilters(params);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-ink-950">Categories</h1>
        <p className="mt-1 text-sm text-ink-500">
          The aisles of your catalog. Products need an active category to appear correctly for retailers.
        </p>
      </div>

      {canManage ? (
        <Card>
          <CardHeader>
            <CardTitle>Add a new category</CardTitle>
          </CardHeader>
          <CategoryForm categories={categoryOptions ?? []} />
        </Card>
      ) : null}

      <Card>
        <form method="get" className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="relative sm:col-span-2 lg:col-span-2">
            <Input name="q" defaultValue={params.q} placeholder="Search categories…" />
          </div>
          <Select name="status" defaultValue={params.status}>
            {ADMIN_STATUS_FILTERS.map((status) => (
              <option key={status} value={status}>
                {STATUS_LABELS[status]}
              </option>
            ))}
          </Select>
          <Select name="sort" defaultValue={params.sort}>
            {TAXONOMY_SORTS.map((sort) => (
              <option key={sort} value={sort}>
                {TAXONOMY_SORT_LABELS[sort]}
              </option>
            ))}
          </Select>
          <div className="flex flex-wrap items-center gap-2 sm:col-span-2 lg:col-span-4">
            <Button type="submit" variant="secondary" size="sm">
              Apply
            </Button>
            {activeFilters ? (
              <Link href="/admin/catalog/categories">
                <Button type="button" variant="ghost" size="sm">
                  Clear {filterCount > 1 ? `${filterCount} filters` : 'filter'}
                </Button>
              </Link>
            ) : null}
          </div>
        </form>
      </Card>

      {rows.length === 0 ? (
        <AdminEmptyState
          icon={Tags}
          title={activeFilters ? 'No categories match your filters' : 'No categories yet'}
          body={
            activeFilters
              ? 'Try a different search term or status, or clear the filters above.'
              : 'Add your first category above — products need a category to appear correctly in the retailer catalog.'
          }
        />
      ) : (
        <>
          <Card className="table-scroll p-0">
            <table className="w-full text-sm">
              <thead className="border-b border-ink-100 bg-ink-50 text-left text-xs uppercase tracking-wide text-ink-500">
                <tr>
                  <th className="px-5 py-3 font-medium">Name</th>
                  <th className="hidden px-5 py-3 font-medium sm:table-cell">Parent</th>
                  <th className="hidden px-5 py-3 font-medium md:table-cell">Products</th>
                  <th className="px-5 py-3 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100">
                {rows.map((category) => (
                  <tr key={category.id}>
                    <td className="px-5 py-3 font-medium text-ink-900">
                      {category.name}
                      <span className="ml-2 text-xs font-normal text-ink-400 sm:hidden">
                        {category.parentName ? `under ${category.parentName}` : 'top level'}
                      </span>
                    </td>
                    <td className="hidden px-5 py-3 text-ink-600 sm:table-cell">
                      {category.parentName ?? '— Top level —'}
                    </td>
                    <td className="hidden px-5 py-3 text-ink-600 md:table-cell">
                      {category.products?.[0]?.count ?? 0}
                    </td>
                    <td className="px-5 py-3">
                      {canManage ? (
                        <CategoryRowActions id={category.id} isActive={category.is_active} />
                      ) : (
                        <span
                          className={
                            category.is_active
                              ? 'rounded-lg bg-primary-50 px-2.5 py-1 text-xs font-medium text-primary-700'
                              : 'rounded-lg bg-ink-100 px-2.5 py-1 text-xs font-medium text-ink-500'
                          }
                        >
                          {category.is_active ? 'Active' : 'Inactive'}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>

          {totalPages > 1 ? (
            <div className="flex items-center justify-center gap-2">
              {params.page > 1 ? (
                <Link href={taxonomyPageHref('/admin/catalog/categories', params, params.page - 1)}>
                  <Button size="sm" variant="outline">
                    Previous
                  </Button>
                </Link>
              ) : null}
              <span className="text-xs text-ink-400">
                Page {params.page} of {totalPages} · {total} categor{total === 1 ? 'y' : 'ies'}
              </span>
              {params.page < totalPages ? (
                <Link href={taxonomyPageHref('/admin/catalog/categories', params, params.page + 1)}>
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
