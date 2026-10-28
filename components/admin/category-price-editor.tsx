'use client';

import { useState, useTransition } from 'react';
import { Loader2, Save } from 'lucide-react';
import {
  RETAILER_CATEGORIES,
  RETAILER_CATEGORY_LABELS,
  validateCategoryPriceOrdering,
  type RetailerCategory,
} from '@/lib/pricing/category-pricing';
import { deactivateCategoryPriceAction, upsertCategoryPriceAction } from '@/lib/admin/tier-pricing-actions';

export interface CategoryPriceRowView {
  id: string;
  category: RetailerCategory;
  price: number;
}

export interface CategoryPriceEditorProps {
  packId: string;
  productName: string;
  packName: string;
  /** Currently configured, ACTIVE category prices for this pack. */
  prices: CategoryPriceRowView[];
  /** Shown only as context for an admin — never sent back to the browser for retailers. */
  slabPrices: number[];
}

const currency = (value: number) => `₹${value.toFixed(2)}`;

/**
 * Admin editor for the three retailer category prices of ONE pack.
 *
 * Ordering is checked here for a fast, readable message and re-checked by the
 * database trigger on write — the client check is a convenience, never the
 * enforcement boundary.
 */
export function CategoryPriceEditor({ packId, productName, packName, prices, slabPrices }: CategoryPriceEditorProps) {
  const initial = Object.fromEntries(
    RETAILER_CATEGORIES.map((category) => [category, prices.find((row) => row.category === category)?.price ?? ''])
  ) as Record<RetailerCategory, number | ''>;

  const [values, setValues] = useState(initial);
  const [feedback, setFeedback] = useState<{ error?: string; success?: string } | null>(null);
  const [isPending, startTransition] = useTransition();

  const numeric = {
    general: values.general === '' ? null : Number(values.general),
    silver: values.silver === '' ? null : Number(values.silver),
    gold: values.gold === '' ? null : Number(values.gold),
  };
  const ordering = validateCategoryPriceOrdering(numeric);

  function save(category: RetailerCategory) {
    const full = numeric[category];
    if (full === null || !Number.isFinite(full) || full <= 0) {
      setFeedback({ error: 'Enter a price greater than zero.' });
      return;
    }
    const data = new FormData();
    data.set('packId', packId);
    data.set('category', category);
    data.set('price', String(full));
    startTransition(async () => {
      const result = await upsertCategoryPriceAction(data).catch(() => ({ error: 'The price could not be saved.' }));
      setFeedback(result);
    });
  }

  function deactivate(id: string) {
    if (!window.confirm('Deactivate this category price? The pack will fall back to the general price or its quantity slabs.')) {
      return;
    }
    const data = new FormData();
    data.set('priceId', id);
    startTransition(async () => {
      const result = await deactivateCategoryPriceAction(data).catch(() => ({ error: 'The price could not be updated.' }));
      setFeedback(result);
    });
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-ink-900">{productName}</p>
          <p className="text-xs text-ink-500">
            {packName}
            {slabPrices.length > 0
              ? ` · quantity slabs: ${slabPrices.map((price) => currency(price)).join(' → ')}`
              : ''}
          </p>
        </div>
        <span className={`text-xs font-medium ${ordering.ok ? 'text-mint-700' : 'text-warning-800'}`}>
          {ordering.ok ? 'Ordering valid: gold ≤ silver ≤ general' : ordering.message}
        </span>
      </div>

      <div className="grid gap-2 sm:grid-cols-3">
        {RETAILER_CATEGORIES.map((category) => {
          const row = prices.find((entry) => entry.category === category);
          return (
            <div key={category} className="rounded-xl border border-ink-200 p-2.5">
              <label htmlFor={`${packId}-${category}`} className="block text-[11px] font-medium text-ink-600">
                {RETAILER_CATEGORY_LABELS[category].en}
              </label>
              <div className="mt-1 flex items-center gap-1.5">
                <input
                  id={`${packId}-${category}`}
                  type="number"
                  min="0.01"
                  step="0.01"
                  inputMode="decimal"
                  value={values[category]}
                  onChange={(event) =>
                    setValues((current) => ({ ...current, [category]: event.target.value === '' ? '' : Number(event.target.value) }))
                  }
                  className="h-8 w-full rounded-lg border border-ink-200 px-2 text-sm"
                  placeholder="₹ per piece"
                />
                <button
                  type="button"
                  disabled={isPending}
                  onClick={() => save(category)}
                  className="inline-flex h-8 items-center gap-1 rounded-lg bg-primary-600 px-2 text-[11px] font-semibold text-white hover:bg-primary-700 disabled:opacity-50"
                >
                  {isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
                  Save
                </button>
              </div>
              {row ? (
                <button
                  type="button"
                  disabled={isPending}
                  onClick={() => deactivate(row.id)}
                  className="mt-1.5 text-[11px] font-medium text-ink-500 underline-offset-2 hover:text-warning-800 hover:underline"
                >
                  Deactivate {currency(row.price)}
                </button>
              ) : (
                <p className="mt-1.5 text-[11px] text-ink-400">Not configured</p>
              )}
            </div>
          );
        })}
      </div>

      {feedback?.error ? (
        <p role="alert" className="text-xs font-medium text-warning-800">
          {feedback.error}
        </p>
      ) : null}
      {feedback?.success ? (
        <p role="status" className="text-xs font-medium text-mint-700">
          {feedback.success}
        </p>
      ) : null}
    </div>
  );
}
