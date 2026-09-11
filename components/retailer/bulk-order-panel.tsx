'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { CheckCircle2, ClipboardPaste, Loader2, PackageSearch, ShoppingCart, X } from 'lucide-react';
import {
  addBulkLinesAction,
  matchBulkLinesAction,
  type BulkMatch,
} from '@/lib/retailer/bulk-order-actions';
import { formatInr } from '@/lib/retailer/format';

type Stage = 'input' | 'review';

/**
 * Bulk cart entry: paste a handwritten-style order list ("2 x tea 250g"),
 * review the server-matched packs (name / brand / barcode search, real
 * effective prices), fix quantities, then add everything to the cart through
 * the same validation as manual adds.
 */
export function BulkOrderPanel() {
  const router = useRouter();
  const [stage, setStage] = useState<Stage>('input');
  const [raw, setRaw] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [matches, setMatches] = useState<BulkMatch[]>([]);
  // packId chosen per line + editable quantity per line
  const [choices, setChoices] = useState<Record<number, { packId: string; quantity: number }>>({});
  const [added, setAdded] = useState<number | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleMatch() {
    setError(null);
    startTransition(async () => {
      const result = await matchBulkLinesAction(raw);
      if (result.error || !result.matches) {
        setError(result.error ?? 'Could not read that list.');
        return;
      }
      const nextChoices: Record<number, { packId: string; quantity: number }> = {};
      result.matches.forEach((match, index) => {
        const pack = match.matches[0];
        if (pack) {
          nextChoices[index] = { packId: pack.packId, quantity: match.quantity ?? pack.moq };
        }
      });
      setMatches(result.matches);
      setChoices(nextChoices);
      setStage('review');
    });
  }

  function handleAddAll() {
    setError(null);
    startTransition(async () => {
      const lines = Object.values(choices).map(({ packId, quantity }) => ({ packId, quantity }));
      const result = await addBulkLinesAction(lines);
      if (result.error) {
        setError(result.error);
        return;
      }
      setAdded(result.addedCount ?? lines.length);
      setMatches([]);
      setChoices({});
      setRaw('');
      setStage('input');
      router.refresh();
    });
  }

  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="flex items-center gap-2 border-b border-slate-100 bg-slate-50 px-4 py-3.5">
        <ClipboardPaste className="h-4 w-4 text-primary-600" aria-hidden="true" />
        <h2 className="text-sm font-bold text-slate-900">Paste a full order list</h2>
      </div>
      <div className="space-y-3 p-4">
        <p className="text-[11px] leading-4 text-slate-500">
          One product per line. Optional quantity: <code className="rounded bg-slate-100 px-1 font-mono text-[10px]">2 x tea 250g</code> or{' '}
          <code className="rounded bg-slate-100 px-1 font-mono text-[10px]">biscuit x 24</code>. Names, brands, sizes and barcodes all work.
        </p>

        {stage === 'input' ? (
          <>
            <textarea
              value={raw}
              onChange={(event) => setRaw(event.target.value)}
              rows={5}
              placeholder={'2 x Tata Salt 1kg\nParle-G 800g x 3\n8901234567890'}
              aria-label="Bulk order list"
              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 font-mono text-xs text-slate-900 outline-none placeholder:text-slate-400 focus:border-primary-300 focus:ring-2 focus:ring-primary-100"
            />
            {added !== null ? (
              <p role="status" className="flex items-center gap-1.5 rounded-xl bg-emerald-50 px-3 py-2 text-[11px] font-semibold text-emerald-700">
                <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" /> {added} line{added === 1 ? '' : 's'} added to your cart.
              </p>
            ) : null}
            {error ? (
              <p role="alert" className="rounded-xl bg-rose-50 px-3 py-2 text-[11px] font-semibold text-rose-700">{error}</p>
            ) : null}
            <button
              type="button"
              onClick={handleMatch}
              disabled={isPending || raw.trim().length === 0}
              className="flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-primary-600 text-xs font-bold text-white transition hover:bg-primary-700 disabled:opacity-60"
            >
              {isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <PackageSearch className="h-4 w-4" aria-hidden="true" />}
              Match products
            </button>
          </>
        ) : (
          <>
            <ul className="space-y-2.5">
              {matches.map((match, index) => {
                const choice = choices[index];
                const selectedPack = match.matches.find((pack) => pack.packId === choice?.packId);
                return (
                  <li key={`${match.line}-${index}`} className="rounded-xl border border-slate-200 p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-[11px] font-bold text-slate-900">
                          {match.brandName ? `${match.brandName} · ` : ''}{match.productName}
                        </p>
                        <p className="truncate text-[10px] text-slate-400">“{match.line}”</p>
                      </div>
                      {match.error ? (
                        <span className="shrink-0 rounded-full bg-rose-50 px-2 py-1 text-[9px] font-bold text-rose-700">{match.error}</span>
                      ) : null}
                    </div>
                    {match.matches.length > 0 && choice ? (
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <label className="sr-only" htmlFor={`pack-${index}`}>Pack size</label>
                        <select
                          id={`pack-${index}`}
                          value={choice.packId}
                          onChange={(event) =>
                            setChoices((prev) => {
                              const pack = match.matches.find((candidate) => candidate.packId === event.target.value);
                              const current = prev[index] ?? { packId: event.target.value, quantity: 1 };
                              return {
                                ...prev,
                                [index]: {
                                  packId: event.target.value,
                                  quantity: Math.max(current.quantity, pack?.moq ?? 1),
                                },
                              };
                            })
                          }
                          className="h-9 max-w-[55%] rounded-lg border border-slate-200 bg-white px-2 text-[11px] font-semibold text-slate-800 outline-none focus:border-primary-300"
                        >
                          {match.matches.map((pack) => (
                            <option key={pack.packId} value={pack.packId}>
                              {pack.packName} · {formatInr(pack.unitPrice)}/pc
                            </option>
                          ))}
                        </select>
                        <label className="sr-only" htmlFor={`qty-${index}`}>Quantity in pieces</label>
                        <input
                          id={`qty-${index}`}
                          type="number"
                          inputMode="numeric"
                          min={selectedPack?.moq ?? 1}
                          value={choice.quantity}
                          onChange={(event) =>
                            setChoices((prev) => {
                              const current = prev[index] ?? { packId: selectedPack?.packId ?? '', quantity: 1 };
                              return {
                                ...prev,
                                [index]: { ...current, quantity: Math.max(1, Math.round(Number(event.target.value) || 1)) },
                              };
                            })
                          }
                          className="h-9 w-20 rounded-lg border border-slate-200 bg-white px-2 text-[11px] font-semibold text-slate-900 outline-none focus:border-primary-300"
                        />
                        <span className="text-[9px] font-semibold text-slate-400">pcs (min {selectedPack?.moq ?? 1})</span>
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
            {error ? (
              <p role="alert" className="rounded-xl bg-rose-50 px-3 py-2 text-[11px] font-semibold text-rose-700">{error}</p>
            ) : null}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={handleAddAll}
                disabled={isPending || Object.keys(choices).length === 0}
                className="flex h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-primary-600 text-xs font-bold text-white transition hover:bg-primary-700 disabled:opacity-60"
              >
                {isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <ShoppingCart className="h-4 w-4" aria-hidden="true" />}
                Add to cart
              </button>
              <button
                type="button"
                onClick={() => {
                  setStage('input');
                  setMatches([]);
                  setError(null);
                }}
                className="flex h-11 items-center gap-1.5 rounded-xl border border-slate-200 px-4 text-xs font-bold text-slate-600 transition hover:bg-slate-50"
              >
                <X className="h-3.5 w-3.5" aria-hidden="true" /> Back
              </button>
            </div>
          </>
        )}
      </div>
    </section>
  );
}
