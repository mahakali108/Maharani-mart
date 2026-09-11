'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  CheckCircle2,
  Pencil,
  RotateCcw,
  ShoppingCart,
  Trash2,
} from 'lucide-react';
import {
  deleteSavedCartAction,
  removeSavedCartItemAction,
  renameSavedCartAction,
  restoreSavedCartAction,
  restoreSavedCartItemAction,
} from '@/lib/retailer/saved-cart-actions';

export interface SavedCartItemView {
  id: string;
  quantity: number;
  productName: string;
  packName: string;
  brandName: string | null;
  imageUrl: string | null;
}

export interface SavedCartView {
  id: string;
  name: string;
  updatedAt: string;
  items: SavedCartItemView[];
}

function SavedCartCard({ cart }: { cart: SavedCartView }) {
  const router = useRouter();
  const [status, setStatus] = useState<{ error?: string; success?: string } | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(cart.name);
  const [isPending, startTransition] = useTransition();

  function run(fn: () => Promise<unknown>, successMessage?: string) {
    setStatus(null);
    startTransition(async () => {
      const result = await fn();
      if (
        result &&
        typeof result === 'object' &&
        'error' in result &&
        typeof (result as { error?: unknown }).error === 'string'
      ) {
        setStatus({ error: (result as { error: string }).error });
        return;
      }
      setStatus({ success: successMessage });
      router.refresh();
    });
  }

  return (
    <li className="rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="flex items-start justify-between gap-2 border-b border-slate-100 p-4">
        <div className="min-w-0 flex-1">
          {renaming ? (
            <div className="flex items-center gap-1.5">
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                maxLength={60}
                aria-label="Saved cart name"
                className="h-9 min-w-0 flex-1 rounded-lg border border-slate-200 px-2.5 text-xs font-bold text-slate-900 outline-none focus:border-primary-300 focus:ring-2 focus:ring-primary-100"
              />
              <button
                type="button"
                disabled={isPending}
                onClick={() =>
                  run(() => renameSavedCartAction(cart.id, name), 'Cart renamed.')
                }
                className="h-9 shrink-0 rounded-lg bg-primary-600 px-3 text-[10px] font-bold text-white transition hover:bg-primary-700 disabled:opacity-60"
              >
                Save
              </button>
            </div>
          ) : (
            <>
              <p className="truncate text-sm font-bold text-slate-900">{cart.name}</p>
              <p className="mt-0.5 text-[10px] text-slate-500">
                {cart.items.length} item{cart.items.length === 1 ? '' : 's'}
              </p>
            </>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {!renaming ? (
            <button
              type="button"
              onClick={() => setRenaming(true)}
              aria-label="Rename saved cart"
              title="Rename"
              className="flex h-9 w-9 items-center justify-center rounded-xl text-slate-400 transition hover:bg-slate-50 hover:text-primary-600"
            >
              <Pencil className="h-4 w-4" aria-hidden="true" />
            </button>
          ) : null}
          <button
            type="button"
            disabled={isPending}
            aria-label="Delete saved cart"
            title="Delete saved cart"
            onClick={() => run(() => deleteSavedCartAction(cart.id), 'Saved cart deleted.')}
            className="flex h-9 w-9 items-center justify-center rounded-xl text-slate-400 transition hover:bg-rose-50 hover:text-rose-600 disabled:opacity-50"
          >
            <Trash2 className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      </div>

      <ul className="divide-y divide-slate-100">
        {cart.items.map((item) => (
          <li key={item.id} className="flex items-center gap-3 px-4 py-3">
            <div className="min-w-0 flex-1">
              <p className="truncate text-[11px] font-bold text-slate-900">{item.productName}</p>
              <p className="mt-0.5 truncate text-[10px] text-slate-500">
                {item.brandName ? `${item.brandName} · ` : ''}{item.packName} · Qty {item.quantity}
              </p>
            </div>
            <button
              type="button"
              disabled={isPending}
              onClick={() => run(() => restoreSavedCartItemAction(item.id), 'Added to cart.')}
              className="flex h-8 shrink-0 items-center gap-1 rounded-lg border border-slate-200 px-2.5 text-[10px] font-bold text-slate-700 transition hover:border-primary-200 hover:bg-primary-50 hover:text-primary-700 disabled:opacity-50"
            >
              <RotateCcw className="h-3 w-3" aria-hidden="true" /> Add
            </button>
            <button
              type="button"
              disabled={isPending}
              aria-label="Remove saved item"
              onClick={() => run(() => removeSavedCartItemAction(item.id), 'Item removed.')}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-300 transition hover:bg-rose-50 hover:text-rose-600 disabled:opacity-50"
            >
              <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </li>
        ))}
      </ul>

      <div className="p-4 pt-3">
        {status?.error ? (
          <p role="alert" className="mb-2 rounded-xl bg-rose-50 px-3 py-2 text-[11px] font-semibold text-rose-700">{status.error}</p>
        ) : null}
        {status?.success ? (
          <p role="status" className="mb-2 flex items-center gap-1.5 rounded-xl bg-emerald-50 px-3 py-2 text-[11px] font-semibold text-emerald-700">
            <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" /> {status.success}
          </p>
        ) : null}
        <button
          type="button"
          disabled={isPending}
          onClick={() => run(() => restoreSavedCartAction(cart.id), 'Saved cart moved into your cart.')}
          className="flex h-10 w-full items-center justify-center gap-2 rounded-xl bg-primary-600 px-4 text-xs font-bold text-white transition hover:bg-primary-700 disabled:opacity-60"
        >
          <ShoppingCart className="h-4 w-4" aria-hidden="true" /> Restore into cart
        </button>
        <p className="mt-1.5 text-center text-[9px] text-slate-400">
          Restores by merging — prices are re-checked at the current rate.
        </p>
      </div>
    </li>
  );
}

export function SavedCartList({ carts }: { carts: SavedCartView[] }) {
  return (
    <ul className="space-y-3">
      {carts.map((cart) => (
        <SavedCartCard key={cart.id} cart={cart} />
      ))}
    </ul>
  );
}
