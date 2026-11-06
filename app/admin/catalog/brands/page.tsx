import Link from 'next/link';
import { Tag } from 'lucide-react';
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
} from '@/lib/admin/taxonomy-query';
import { loadAdminBrandBatch, type AdminBrandRow } from '@/lib/admin/taxonomy-data';
import {
  InfiniteScrollProvider,
  InfiniteScrollRows,
  InfiniteScrollStatus,
  InfiniteScrollTableSkeleton,
  type InfiniteScrollBatch,
} from '@/components/ui/infinite-scroll';
import { readCursor } from '@/lib/infinite-scroll/keyset';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { BrandForm } from '@/components/admin/brand-form';
import { BrandRowActions } from '@/components/admin/brand-row-actions';
import { AdminEmptyState } from '@/components/admin/empty-state';

/** Shared by the first (server-rendered) batch and every batch after it. */
function renderBrandRows(rows: AdminBrandRow[], canManage: boolean) {
  return rows.map((brand) => (
    <tr key={brand.id}>
      <td className="px-5 py-3 font-medium text-ink-900">{brand.name}</td>
      <td className="hidden px-5 py-3 text-ink-600 md:table-cell">
        {/* Real link count from products.brand_id; "unknown" when the bounded
            count scan could not complete — never an invented zero. */}
        {brand.productCount ?? 'unknown'}
      </td>
      <td className="px-5 py-3">
        {canManage ? (
          <BrandRowActions id={brand.id} isActive={brand.is_active} />
        ) : (
          <span
            className={
              brand.is_active
                ? 'rounded-lg bg-primary-50 px-2.5 py-1 text-xs font-medium text-primary-700'
                : 'rounded-lg bg-ink-100 px-2.5 py-1 text-xs font-medium text-ink-500'
            }
          >
            {brand.is_active ? 'Active' : 'Inactive'}
          </span>
        )}
      </td>
    </tr>
  ));
}

const STATUS_LABELS: Record<AdminStatusFilter, string> = {
  all: 'Any status',
  active: 'Active',
  inactive: 'Inactive',
};

/**
 * Admin brand list. Same single-table shape as the category list: search,
 * status filter, sort and pagination all go to Postgres in one DB-paginated
 * request. The product count per row is the real link count from
 * `products.brand_id` — the number that decides whether a brand is safe to
 * deactivate or delete.
 */
export default async function BrandsPage({
  searchParams: searchParamsPromise,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const searchParams = await searchParamsPromise;
  const user = await requireUser();
  const canManage = can(user.role, 'master_data.manage');
  const params = parseTaxonomyParams(searchParams);
  const supabase = (await createClient());

  const firstBatch = await loadAdminBrandBatch(supabase, params, null);
  const rows = firstBatch.items;

  const activeFilters = hasTaxonomyFilters(params);
  const filterCount = countTaxonomyFilters(params);

  /** Server Action for batches 2..n; filters ride along encrypted. */
  async function loadMoreBrands(cursor: string | null): Promise<InfiniteScrollBatch> {
    'use server';
    await requireUser();
    const batch = await loadAdminBrandBatch((await createClient()), params, readCursor(cursor));
    return { rows: renderBrandRows(batch.items, canManage), nextCursor: batch.nextCursor };
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-ink-950">Brands</h1>
        <p className="mt-1 text-sm text-ink-500">
          The brands retailers can filter the catalog by. Products can optionally be linked to one.
        </p>
      </div>

      {canManage ? (
        <Card>
          <CardHeader>
            <CardTitle>Add a new brand</CardTitle>
          </CardHeader>
          <BrandForm />
        </Card>
      ) : null}

      <Card>
        <form method="get" className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="relative sm:col-span-2 lg:col-span-2">
            <Input name="q" defaultValue={params.q} placeholder="Search brands…" />
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
              <Link href="/admin/catalog/brands">
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
          icon={Tag}
          title={activeFilters ? 'No brands match your filters' : 'No brands yet'}
          body={
            activeFilters
              ? 'Try a different search term or status, or clear the filters above.'
              : 'Add your first brand above — products can optionally be linked to one.'
          }
        />
      ) : (
        <InfiniteScrollProvider
          loader={loadMoreBrands}
          initialCursor={firstBatch.nextCursor}
          initialHasMore={Boolean(firstBatch.nextCursor)}
          resetKey={`${params.q}|${params.status}|${params.sort}`}
        >
          <Card className="table-scroll p-0">
            <table className="w-full text-sm">
              <thead className="border-b border-ink-100 bg-ink-50 text-left text-xs uppercase tracking-wide text-ink-500">
                <tr>
                  <th className="px-5 py-3 font-medium">Name</th>
                  <th className="hidden px-5 py-3 font-medium md:table-cell">Products</th>
                  <th className="px-5 py-3 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100">
                <InfiniteScrollRows skeleton={<InfiniteScrollTableSkeleton columns={3} />}>
                  {renderBrandRows(rows, canManage)}
                </InfiniteScrollRows>
              </tbody>
            </table>
          </Card>

          <InfiniteScrollStatus endLabel="No more brands" loadingLabel="Loading more…" />
        </InfiniteScrollProvider>
      )}
    </div>
  );
}
