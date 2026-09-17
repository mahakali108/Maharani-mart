import Link from 'next/link';
import { Tag } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { requireUser } from '@/lib/auth/session';
import { can } from '@/lib/permissions/permissions';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { StoredImage } from '@/components/media/stored-image';
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
import { BrandForm } from '@/components/admin/brand-form';
import { BrandRowActions } from '@/components/admin/brand-row-actions';
import { AdminEmptyState } from '@/components/admin/empty-state';

interface BrandListRow {
  id: string;
  name: string;
  logo_url: string | null;
  is_active: boolean;
  products: { count: number }[] | null;
}

/**
 * Admin brands list (Phase 7).
 *
 * Same bounded-list contract as the categories list: server-side `ilike`
 * search on name, an is_active status filter and DB pagination. Brands have
 * no hierarchy — just a unique name, an optional logo and the toggle.
 */
export default async function AdminBrandsPage({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const user = await requireUser();
  const params = parseMasterListParams(searchParams);
  const canDelete = can(user.role, 'master_data.delete');
  const supabase = createClient();

  let query = supabase.from('brands').select('id, name, logo_url, is_active, products(count)', { count: 'exact' });
  if (params.q) query = query.ilike('name', `%${params.q}%`);
  if (params.status === 'active') query = query.eq('is_active', true);
  if (params.status === 'inactive') query = query.eq('is_active', false);

  const { from, to } = masterPageRange(params.page);
  const { data, count, error } = await query
    .order('name', { ascending: true })
    .range(from, to)
    .returns<BrandListRow[]>();
  if (error) throw new Error(error.message);

  const rows = data ?? [];
  const total = count ?? 0;
  const totalPages = masterTotalPages(total);
  const hasFilters = hasMasterListFilters(params);

  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
        <div>
          <h1 className="text-2xl font-semibold text-ink-950">Brands</h1>
          <p className="mt-1 text-sm text-ink-500">
            Product brands. A brand can be linked from any product; logos are managed on the edit screen.
          </p>
        </div>
        <div className="flex gap-1 rounded-xl border border-ink-100 bg-white p-1">
          <Link
            href={CATEGORIES_LIST_PATH}
            className="rounded-lg px-3 py-1.5 text-sm font-medium text-ink-600 hover:bg-ink-50 hover:text-ink-900"
          >
            Categories
          </Link>
          <span className="rounded-lg bg-primary-600 px-3 py-1.5 text-sm font-medium text-white">Brands</span>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Add a new brand</CardTitle>
        </CardHeader>
        <BrandForm />
      </Card>

      <Card>
        <form method="get" className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="relative sm:col-span-2">
            <Input name="q" defaultValue={params.q} placeholder="Search brands by name…" />
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
              <Link href={BRANDS_LIST_PATH}>
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
          icon={Tag}
          title={hasFilters ? 'No brands match your filters' : 'No brands yet'}
          body={
            hasFilters
              ? 'Try a different search term or status, or clear the filters above.'
              : 'Add your first brand above — products can optionally be linked to one.'
          }
        />
      ) : (
        <>
          {/* ==================== DESKTOP: TABLE (lg and up) ==================== */}
          <Card className="hidden overflow-hidden p-0 lg:block">
            <div className="table-scroll">
              <table className="w-full min-w-[640px] text-sm">
                <thead className="border-b border-ink-100 bg-ink-50 text-left text-xs uppercase tracking-wide text-ink-500">
                  <tr>
                    <th className="px-5 py-3 font-medium">Brand</th>
                    <th className="px-5 py-3 font-medium">Products</th>
                    <th className="px-5 py-3 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-ink-100">
                  {rows.map((row) => (
                    <tr key={row.id}>
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-3">
                          {row.logo_url ? (
                            <div className="relative h-8 w-8 shrink-0 overflow-hidden rounded-lg border border-ink-200 bg-white">
                              <StoredImage src={row.logo_url} alt={row.name} size="thumb" fill className="object-contain" />
                            </div>
                          ) : null}
                          <Link
                            href={`/admin/catalog/brands/${row.id}`}
                            className="font-medium text-ink-900 hover:text-primary-600"
                          >
                            {row.name}
                          </Link>
                        </div>
                      </td>
                      <td className="px-5 py-3 text-ink-600" title="Includes inactive products">
                        {row.products?.[0]?.count ?? 0}
                      </td>
                      <td className="px-5 py-3">
                        <BrandRowActions id={row.id} name={row.name} isActive={row.is_active} canDelete={canDelete} />
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
                  {row.logo_url ? (
                    <div className="relative h-9 w-9 shrink-0 overflow-hidden rounded-lg border border-ink-200 bg-white">
                      <StoredImage src={row.logo_url} alt={row.name} size="thumb" fill className="object-contain" />
                    </div>
                  ) : null}
                  <div className="min-w-0 flex-1">
                    <Link
                      href={`/admin/catalog/brands/${row.id}`}
                      className="block truncate text-sm font-semibold text-ink-900 hover:text-primary-600"
                    >
                      {row.name}
                    </Link>
                    <p className="mt-0.5 truncate text-xs text-ink-500">
                      {row.products?.[0]?.count ?? 0} product{(row.products?.[0]?.count ?? 0) === 1 ? '' : 's'}
                    </p>
                  </div>
                </div>
                <div className="mt-3 border-t border-ink-100 pt-2.5">
                  <BrandRowActions id={row.id} name={row.name} isActive={row.is_active} canDelete={canDelete} />
                </div>
              </li>
            ))}
          </ul>

          {totalPages > 1 ? (
            <div className="flex items-center justify-center gap-2">
              {params.page > 1 ? (
                <Link href={masterListHref('brands', params, { page: params.page - 1 })}>
                  <Button size="sm" variant="outline">
                    Previous
                  </Button>
                </Link>
              ) : null}
              <span className="text-xs text-ink-400">
                Page {params.page} of {totalPages} · {total} brand{total === 1 ? '' : 's'}
              </span>
              {params.page < totalPages ? (
                <Link href={masterListHref('brands', params, { page: params.page + 1 })}>
                  <Button size="sm" variant="outline">
                    Next
                  </Button>
                </Link>
              ) : null}
            </div>
          ) : (
            <p className="text-center text-xs text-ink-400">
              {total} brand{total === 1 ? '' : 's'}
            </p>
          )}
        </>
      )}
    </div>
  );
}
