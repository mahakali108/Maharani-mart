'use client';

import { useMemo, useState, useTransition } from 'react';
import Link from 'next/link';
import { useFormState } from 'react-dom';
import { AlertTriangle, CheckCircle2, Download } from 'lucide-react';
import { bulkCatalogAction, type BulkResult } from '@/lib/admin/products-bulk-actions';
import { toggleProductActiveAction, deleteProductAction } from '@/lib/admin/products-actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { cn } from '@/lib/utils/cn';
import type { ResolvedAdminProduct } from '@/lib/admin/catalog-data';

interface Option {
  id: string;
  name: string;
}

/** Serialisable subset of the resolved row the table needs. */
export interface BulkPanelProduct {
  id: string;
  name: string;
  base_price: number;
  gst_percent: number;
  hsn_code: string | null;
  barcode: string | null;
  is_active: boolean;
  is_new_launch: boolean;
  updated_at: string;
  brands: { name: string } | null;
  categories: { name: string } | null;
  imageUrl: string | null;
  moq: number | null;
  casePrice: number | null;
  stockStatus: 'healthy' | 'low_stock' | 'out_of_stock' | null;
  available: number | null;
  units30d: number | null;
  margin: number | null;
}

/** Flatten the resolved server row into props a Client Component can receive. */
export function toBulkPanelProduct(row: ResolvedAdminProduct): BulkPanelProduct {
  return {
    id: row.id,
    name: row.name,
    base_price: row.base_price,
    gst_percent: row.gst_percent,
    hsn_code: row.hsn_code,
    barcode: row.barcode,
    is_active: row.is_active,
    is_new_launch: row.is_new_launch,
    updated_at: row.updated_at,
    brands: row.brands,
    categories: row.categories,
    imageUrl: row.product_images[0]?.image_url ?? null,
    moq: row.moq,
    casePrice: row.casePrice,
    stockStatus: row.stock?.status ?? null,
    available: row.stock?.available ?? null,
    units30d: row.sales?.units30d ?? null,
    margin: row.margin,
  };
}

const STOCK_BADGE: Record<NonNullable<BulkPanelProduct['stockStatus']>, { label: string; className: string }> = {
  healthy: { label: 'In stock', className: 'bg-emerald-50 text-emerald-700' },
  low_stock: { label: 'Low', className: 'bg-amber-50 text-amber-700' },
  out_of_stock: { label: 'Out', className: 'bg-rose-50 text-rose-700' },
};

type BulkKind = 'activate' | 'deactivate' | 'category' | 'brand' | 'gst' | 'moq' | 'price';

const initialState: BulkResult | null = null;

/**
 * Admin product table + bulk toolbar.
 *
 * Selection lives here (not in the URL) because a selection is transient: it is
 * meaningless after a filter change and must not survive a reload into a bulk
 * action the operator did not re-confirm. The checkboxes and the toolbar are in
 * the SAME <form> so `productIds` reaches the server action without any hidden
 * state duplication.
 */
export function ProductBulkPanel({
  products,
  brands,
  categories,
  canEdit,
  canDelete,
  canManagePricing,
  canViewCost,
  exportHref,
}: {
  products: ResolvedAdminProduct[];
  brands: Option[];
  categories: Option[];
  canEdit: boolean;
  canDelete: boolean;
  canManagePricing: boolean;
  canViewCost: boolean;
  exportHref: string;
}) {
  const rows = useMemo(() => products.map(toBulkPanelProduct), [products]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkKind, setBulkKind] = useState<BulkKind>('activate');
  const [exporting, startExport] = useTransition();
  const [state, formAction] = useFormState(bulkCatalogAction, initialState);
  const [rowPending, startRowTransition] = useTransition();

  const allSelected = rows.length > 0 && rows.every((row) => selected.has(row.id));
  const ids = [...selected];

  function toggle(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(rows.map((row) => row.id)));
  }

  /** POST the selection so a 200-id export never has to ride in a URL. */
  async function exportSelected() {
    startExport(async () => {
      const response = await fetch('/admin/products/export', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ids }),
      });
      if (!response.ok) return;
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `maharani-products-${new Date().toISOString().slice(0, 10)}.csv`;
      anchor.click();
      URL.revokeObjectURL(url);
    });
  }

  const needsTarget = bulkKind === 'category' || bulkKind === 'brand';
  const actions: { value: BulkKind; label: string; allowed: boolean }[] = [
    { value: 'activate', label: 'Activate', allowed: canEdit },
    { value: 'deactivate', label: 'Deactivate', allowed: canEdit },
    { value: 'category', label: 'Set category', allowed: canEdit },
    { value: 'brand', label: 'Set brand', allowed: canEdit },
    { value: 'gst', label: 'Set GST', allowed: canEdit },
    { value: 'moq', label: 'Set MOQ', allowed: canEdit },
    { value: 'price', label: 'Adjust price', allowed: canManagePricing },
  ];
  const availableActions = actions.filter((action) => action.allowed);

  return (
    <div className="space-y-3">
      {state ? (
        <div
          className={cn(
            'rounded-xl border px-4 py-3 text-sm',
            state.ok ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-rose-200 bg-rose-50 text-rose-700'
          )}
          role="status"
        >
          <p className="flex items-start gap-2">
            {state.ok ? (
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
            ) : (
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            )}
            <span>{state.ok ? state.message : state.error}</span>
          </p>
          {state.ok && state.skipped.length > 0 ? (
            <ul className="mt-2 list-disc space-y-0.5 pl-6 text-xs">
              {state.skipped.slice(0, 6).map((skip) => (
                <li key={skip.id}>
                  <span className="font-semibold">{skip.name}</span> — {skip.reason}
                </li>
              ))}
              {state.skipped.length > 6 ? <li>+{state.skipped.length - 6} more</li> : null}
            </ul>
          ) : null}
        </div>
      ) : null}

      <form action={formAction} className="space-y-3">
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-ink-100 bg-white p-3">
          <span className="text-xs font-semibold text-ink-500">
            {ids.length} selected
          </span>

          {availableActions.length > 0 ? (
            <>
              <Select
                name="bulkAction"
                value={bulkKind}
                onChange={(event) => setBulkKind(event.target.value as BulkKind)}
                className="h-9 w-auto min-w-[9rem]"
                aria-label="Bulk action"
              >
                {availableActions.map((action) => (
                  <option key={action.value} value={action.value}>
                    {action.label}
                  </option>
                ))}
              </Select>

              {needsTarget ? (
                <Select name="targetId" className="h-9 w-auto min-w-[10rem]" aria-label="Target">
                  <option value="">{bulkKind === 'category' ? '— Category —' : '— Brand —'}</option>
                  {(bulkKind === 'category' ? categories : brands).map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.name}
                    </option>
                  ))}
                </Select>
              ) : null}

              {bulkKind === 'gst' ? (
                <Select name="gstPercent" className="h-9 w-auto" aria-label="GST rate">
                  {[0, 5, 12, 18, 28].map((rate) => (
                    <option key={rate} value={rate}>
                      {rate}%
                    </option>
                  ))}
                </Select>
              ) : null}

              {bulkKind === 'moq' ? (
                <Input
                  name="moq"
                  type="number"
                  min={1}
                  step={1}
                  placeholder="MOQ in pcs"
                  className="h-9 w-28"
                  aria-label="MOQ in pieces"
                />
              ) : null}

              {bulkKind === 'price' ? (
                <>
                  <Select name="mode" className="h-9 w-auto" aria-label="Adjustment type">
                    <option value="percent">By %</option>
                    <option value="flat">By ₹ per case</option>
                  </Select>
                  <Input
                    name="delta"
                    type="number"
                    step="0.01"
                    placeholder="e.g. 5 or -2.5"
                    className="h-9 w-32"
                    aria-label="Price adjustment amount"
                  />
                </>
              ) : null}

              <Button type="submit" size="sm" variant="secondary" disabled={ids.length === 0}>
                Apply to {ids.length || '…'}
              </Button>
            </>
          ) : (
            <span className="text-xs text-ink-400">Your role can view the catalog but not change it in bulk.</span>
          )}

          <span className="ml-auto flex items-center gap-2">
            <Button type="button" size="sm" variant="ghost" disabled={ids.length === 0 || exporting} onClick={exportSelected}>
              <Download className="h-3.5 w-3.5" /> Export selected
            </Button>
            <Link href={exportHref}>
              <Button type="button" size="sm" variant="ghost">
                <Download className="h-3.5 w-3.5" /> Export this view
              </Button>
            </Link>
          </span>
        </div>

        <div className="overflow-hidden rounded-xl border border-ink-100 bg-white">
          <div className="table-scroll">
            <table className="w-full min-w-[900px] text-sm">
              <thead className="border-b border-ink-100 bg-ink-50 text-left text-xs uppercase tracking-wide text-ink-500">
                <tr>
                  <th className="px-3 py-3">
                    <input
                      type="checkbox"
                      checked={allSelected}
                      onChange={toggleAll}
                      aria-label="Select all products on this page"
                      className="h-4 w-4 rounded border-ink-300 text-primary-600 focus:ring-primary-600"
                    />
                  </th>
                  <th className="px-4 py-3 font-medium">Product</th>
                  <th className="px-4 py-3 font-medium">Brand</th>
                  <th className="px-4 py-3 font-medium">Category</th>
                  <th className="px-4 py-3 font-medium">MRP / pc</th>
                  {canViewCost ? <th className="px-4 py-3 font-medium">Margin</th> : null}
                  <th className="px-4 py-3 font-medium">GST</th>
                  <th className="px-4 py-3 font-medium">HSN</th>
                  <th className="px-4 py-3 font-medium">MOQ</th>
                  <th className="px-4 py-3 font-medium">Stock</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium" />
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100">
                {rows.map((row) => {
                  const badge = row.stockStatus ? STOCK_BADGE[row.stockStatus] : null;
                  return (
                    <tr key={row.id} className={cn(selected.has(row.id) && 'bg-primary-50/40')}>
                      <td className="px-3 py-3">
                        <input
                          type="checkbox"
                          name="productIds"
                          value={row.id}
                          checked={selected.has(row.id)}
                          onChange={() => toggle(row.id)}
                          aria-label={`Select ${row.name}`}
                          className="h-4 w-4 rounded border-ink-300 text-primary-600 focus:ring-primary-600"
                        />
                      </td>
                      <td className="px-4 py-3">
                        <Link href={`/admin/products/${row.id}`} className="font-medium text-ink-900 hover:text-primary-600">
                          {row.name}
                        </Link>
                        {row.is_new_launch ? (
                          <span className="ml-2 rounded-full bg-primary-50 px-2 py-0.5 text-[10px] font-semibold uppercase text-primary-600">
                            New
                          </span>
                        ) : null}
                        {row.barcode ? (
                          <p className="mt-0.5 font-mono text-[11px] text-ink-400">{row.barcode}</p>
                        ) : null}
                      </td>
                      <td className="px-4 py-3 text-ink-600">{row.brands?.name ?? '—'}</td>
                      <td className="px-4 py-3 text-ink-600">{row.categories?.name ?? '—'}</td>
                      <td className="px-4 py-3 text-ink-600">₹{row.base_price.toFixed(2)}</td>
                      {canViewCost ? (
                        <td className="px-4 py-3 text-ink-600">
                          {row.margin === null ? (
                            <span className="text-ink-300">—</span>
                          ) : (
                            <span className={cn(row.margin < 0 && 'font-semibold text-rose-600')}>
                              {row.margin.toFixed(2)}%
                            </span>
                          )}
                        </td>
                      ) : null}
                      <td className="px-4 py-3 text-ink-600">{row.gst_percent}%</td>
                      <td className="px-4 py-3 font-mono text-xs text-ink-500">{row.hsn_code ?? '—'}</td>
                      <td className="px-4 py-3 text-ink-600">{row.moq ?? '—'}</td>
                      <td className="px-4 py-3">
                        {badge ? (
                          <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-bold', badge.className)}>
                            {badge.label}
                            {row.available !== null ? ` · ${row.available}` : ''}
                          </span>
                        ) : (
                          <span className="text-xs text-ink-300">Unknown</span>
                        )}
                        {row.units30d !== null ? (
                          <p className="mt-0.5 text-[10px] text-ink-400">{row.units30d} sold / 30d</p>
                        ) : null}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={cn(
                            'rounded-full px-2 py-0.5 text-[10px] font-bold',
                            row.is_active ? 'bg-emerald-50 text-emerald-700' : 'bg-ink-100 text-ink-500'
                          )}
                        >
                          {row.is_active ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        {canEdit ? (
                          <button
                            type="button"
                            disabled={rowPending}
                            onClick={() =>
                              startRowTransition(() => toggleProductActiveAction(row.id, !row.is_active))
                            }
                            className="mr-2 text-xs font-medium text-primary-600 hover:text-primary-700 disabled:opacity-50"
                          >
                            {row.is_active ? 'Deactivate' : 'Activate'}
                          </button>
                        ) : null}
                        {canDelete ? (
                          <button
                            type="button"
                            disabled={rowPending}
                            onClick={() => {
                              if (confirm(`Delete “${row.name}” permanently? This cannot be undone.`)) {
                                startRowTransition(() => deleteProductAction(row.id));
                              }
                            }}
                            className="text-xs font-medium text-rose-600 hover:text-rose-700 disabled:opacity-50"
                          >
                            Delete
                          </button>
                        ) : null}
                        <Link
                          href={`/admin/products/${row.id}`}
                          className="ml-2 text-xs font-medium text-ink-500 hover:text-ink-800"
                        >
                          Edit
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </form>
    </div>
  );
}
