'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { BookmarkPlus, Check, FolderOpen, Loader2 } from 'lucide-react';
import { saveCurrentCartAction } from '@/lib/retailer/saved-cart-actions';

/**
 * Cart header controls: save the whole cart as a named list and reach the
 * saved-carts page. Only pack references + quantities are saved — restoring
 * re-validates availability and re-prices at the current rate.
 */
export function CartSaveControls({ itemCount }: { itemCount: number }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [isPending, startTransition] = useTransition();

  function handleSave() {
    setError(null);
    startTransition(async () => {
      const result = await saveCurrentCartAction(name || 'My cart');
      if ('error' in result && result.error) {
        setError(result.error);
        return;
      }
      setSaved(true);
      setOpen(false);
      setName('');
      router.refresh();
    });
  }

  return (
    <div className="relative flex items-center gap-2">
      <Link
        href="/retailer/cart/saved"
        className="flex h-9 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-[10px] font-bold text-slate-700 shadow-sm transition hover:border-primary-200 hover:text-primary-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-300"
      >
        <FolderOpen className="h-3.5 w-3.5" aria-hidden="true" /> Saved carts
      </Link>
      <button
        type="button"
        disabled={itemCount === 0}
        onClick={() => {
          setSaved(false);
          setOpen((value) => !value);
        }}
        className="flex h-9 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-[10px] font-bold text-slate-700 shadow-sm transition hover:border-primary-200 hover:text-primary-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-300 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {saved ? <Check className="h-3.5 w-3.5 text-emerald-600" aria-hidden="true" /> : <BookmarkPlus className="h-3.5 w-3.5" aria-hidden="true" />}
        {saved ? 'Saved' : 'Save cart'}
      </button>

      {open ? (
        <div className="absolute right-0 top-11 z-30 w-64 rounded-2xl border border-slate-200 bg-white p-3 shadow-lg">
          <label htmlFor="save-cart-name" className="mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-slate-500">
            Name this cart
          </label>
          <input
            id="save-cart-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={60}
            placeholder="e.g. Weekly stock — June"
            className="h-10 w-full rounded-xl border border-slate-200 px-3 text-xs text-slate-900 outline-none focus:border-primary-300 focus:ring-2 focus:ring-primary-100"
          />
          {error ? (
            <p role="alert" className="mt-2 rounded-lg bg-rose-50 px-2.5 py-1.5 text-[10px] font-semibold text-rose-700">{error}</p>
          ) : null}
          <div className="mt-2.5 flex gap-2">
            <button
              type="button"
              onClick={handleSave}
              disabled={isPending}
              className="flex h-9 flex-1 items-center justify-center gap-1.5 rounded-xl bg-primary-600 px-3 text-[10px] font-bold text-white transition hover:bg-primary-700 disabled:opacity-60"
            >
              {isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <BookmarkPlus className="h-3.5 w-3.5" aria-hidden="true" />}
              Save
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="flex h-9 items-center rounded-xl border border-slate-200 px-3 text-[10px] font-bold text-slate-600"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
