'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { GitCompareArrows, Scale, X } from 'lucide-react';
import { ProductCard, type ProductCardProps } from '@/components/retailer/product-card';
import { formatInr } from '@/lib/retailer/format';
import { cn } from '@/lib/utils/cn';

const COMPARE_KEY = 'maharani.compareIds.v1';
const MAX_COMPARE = 4;

function readStoredIds(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(COMPARE_KEY) ?? '[]') as unknown;
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string').slice(0, MAX_COMPARE) : [];
  } catch {
    return [];
  }
}

/**
 * Catalog product grid with an honest, lightweight comparison: pick up to 4
 * products, then compare the REAL card data the server already priced for
 * this retailer (from-price, MRP, discount, GST, MOQ, best pack). No invented
 * ratings or specs — only fields that exist on the priced card.
 */
export function CompareGrid({ cards }: { cards: ProductCardProps[] }) {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setSelectedIds(readStoredIds().filter((id) => cards.some((card) => card.id === id)));
    setHydrated(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function toggle(id: string) {
    setSelectedIds((prev) => {
      const next = prev.includes(id) ? prev.filter((value) => value !== id) : [...prev, id].slice(0, MAX_COMPARE);
      try {
        window.localStorage.setItem(COMPARE_KEY, JSON.stringify(next));
      } catch {
        // private-mode storage failure is non-fatal
      }
      return next;
    });
  }

  const selected = useMemo(
    () => selectedIds.map((id) => cards.find((card) => card.id === id)).filter((card): card is ProductCardProps => !!card),
    [selectedIds, cards]
  );

  const rows: { label: string; render: (card: ProductCardProps) => string }[] = [
    { label: 'From price', render: (card) => (card.fromPrice !== null ? `${formatInr(card.fromPrice)} /pc` : '—') },
    { label: 'MRP', render: (card) => (card.mrp ? formatInr(card.mrp) : '—') },
    {
      label: 'Discount',
      render: (card) => {
        if (!card.mrp || card.fromPrice === null) return '—';
        const pct = Math.round(((card.mrp - card.fromPrice) / card.mrp) * 100);
        return pct > 0 ? `${pct}% off` : '—';
      },
    },
    { label: 'GST', render: (card) => (card.gstPercent !== undefined ? `${card.gstPercent}%` : '—') },
    { label: 'Min. order', render: (card) => `${card.moq ?? 1} pc` },
    { label: 'Best pack', render: (card) => card.packName ?? '—' },
    { label: 'Brand', render: (card) => card.brandName ?? '—' },
    {
      label: 'Tier offer',
      render: (card) => (card.nextTierHint ? card.nextTierHint.label : '—'),
    },
  ];

  return (
    <div className="relative">
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4 xl:grid-cols-5">
        {cards.map((card) => {
          const checked = selectedIds.includes(card.id);
          return (
            <div key={card.id} className="relative">
              <ProductCard {...card} />
              {hydrated ? (
                <button
                  type="button"
                  onClick={() => toggle(card.id)}
                  aria-pressed={checked}
                  className={cn(
                    'mt-1 flex h-8 w-full items-center justify-center gap-1.5 rounded-xl border text-[10px] font-bold transition',
                    checked
                      ? 'border-primary-500 bg-primary-50 text-primary-700'
                      : 'border-slate-200 bg-white text-slate-500 hover:border-primary-200 hover:text-primary-600'
                  )}
                >
                  <GitCompareArrows className="h-3.5 w-3.5" aria-hidden="true" />
                  {checked ? 'Comparing' : 'Compare'}
                </button>
              ) : (
                <div className="mt-1 h-8" />
              )}
            </div>
          );
        })}
      </div>

      {/* Floating compare tray — sits above the bottom nav, safe-area aware. */}
      {selected.length >= 2 && !sheetOpen ? (
        <div className="fixed inset-x-3 bottom-[calc(4.75rem+env(safe-area-inset-bottom))] z-40 mx-auto flex max-w-md items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-2.5 shadow-lg lg:bottom-6">
          <p className="min-w-0 truncate text-[11px] font-bold text-slate-700">
            {selected.length} product{selected.length === 1 ? '' : 's'} selected
          </p>
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={() => setSheetOpen(true)}
              className="flex h-9 items-center gap-1.5 rounded-xl bg-primary-600 px-3.5 text-[11px] font-bold text-white transition hover:bg-primary-700"
            >
              <Scale className="h-3.5 w-3.5" aria-hidden="true" /> Compare
            </button>
            <button
              type="button"
              onClick={() => selected.forEach((card) => toggle(card.id))}
              aria-label="Clear comparison"
              className="flex h-9 w-9 items-center justify-center rounded-xl text-slate-400 transition hover:bg-slate-50"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        </div>
      ) : null}

      {/* Comparison sheet */}
      {sheetOpen && selected.length >= 2 ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Product comparison"
          className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/40 sm:items-center"
          onClick={(event) => {
            if (event.target === event.currentTarget) setSheetOpen(false);
          }}
        >
          <div className="max-h-[88dvh] w-full overflow-hidden rounded-t-3xl bg-white shadow-2xl pb-[calc(0.75rem+env(safe-area-inset-bottom))] sm:max-w-2xl sm:rounded-3xl">
            <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
              <h2 className="flex items-center gap-1.5 text-sm font-bold text-slate-900">
                <Scale className="h-4 w-4 text-primary-600" aria-hidden="true" /> Compare products
              </h2>
              <button
                type="button"
                onClick={() => setSheetOpen(false)}
                aria-label="Close comparison"
                className="flex h-9 w-9 items-center justify-center rounded-xl text-slate-400 transition hover:bg-slate-50"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
            <div className="max-h-[calc(88dvh-4rem)] overflow-auto">
              <table className="w-full min-w-[480px] border-collapse text-left">
                <thead>
                  <tr>
                    <th className="sticky left-0 z-10 w-20 bg-white px-3 py-2 text-[9px] font-bold uppercase tracking-wider text-slate-400">
                      Feature
                    </th>
                    {selected.map((card) => (
                      <th key={card.id} className="min-w-[7.5rem] px-3 py-2 align-bottom">
                        <Link href={`/retailer/catalog/${card.id}`} className="block">
                          <span className="block h-14 w-14 overflow-hidden rounded-xl bg-slate-50">
                            {card.imageUrl ? (
                              <Image src={card.imageUrl} alt="" width={56} height={56} className="h-14 w-14 object-contain p-1" unoptimized />
                            ) : null}
                          </span>
                          <span className="mt-1.5 block text-[10px] font-bold leading-4 text-slate-900">{card.name}</span>
                        </Link>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, rowIndex) => (
                    <tr key={row.label} className={rowIndex % 2 === 0 ? 'bg-slate-50/60' : ''}>
                      <th scope="row" className="sticky left-0 z-10 bg-inherit px-3 py-2 text-[10px] font-bold text-slate-500">
                        {row.label}
                      </th>
                      {selected.map((card) => (
                        <td key={card.id} className="px-3 py-2 text-[11px] font-semibold text-slate-900">
                          {row.render(card)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
