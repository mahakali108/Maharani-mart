import Link from 'next/link';
import { ArrowRight, ShoppingCart } from 'lucide-react';
import { formatInr } from '@/lib/retailer/format';
import type { HomeCartSummary as Summary } from '@/lib/retailer/home-data';

export function HomeCartSummary({ cart }: { cart: Summary }) {
  const empty = cart.itemCount === 0 && !cart.unavailable;
  return (
    <section aria-labelledby="home-cart-title" className="min-w-0 rounded-2xl border border-action-100 bg-white p-4 shadow-sm sm:p-5">
      <div className="flex items-center gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-action-50 text-action-700"><ShoppingCart className="h-5 w-5" aria-hidden="true" /></span>
        <div className="min-w-0"><h2 id="home-cart-title" className="text-base font-bold text-slate-900">Your cart</h2><p className="mt-0.5 text-[11px] text-slate-500">Keep your next restock moving.</p></div>
      </div>
      {empty ? <>
        <p className="mt-5 text-sm font-semibold text-slate-800">Your cart is empty</p>
        <p className="mt-1 text-xs leading-5 text-slate-500">Add the products your shop needs. We’ll keep them here for you.</p>
        <Link href="/retailer/catalog" className="mt-5 flex min-h-11 items-center justify-center gap-2 rounded-xl bg-action-600 px-4 text-xs font-semibold text-white hover:bg-action-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action-500 focus-visible:ring-offset-2">Browse Products <ArrowRight className="h-4 w-4" aria-hidden="true" /></Link>
      </> : <>
        <dl className="mt-4 space-y-3 text-xs">
          <div className="flex flex-wrap justify-between gap-2"><dt className="text-slate-600">Cart items</dt><dd className="font-semibold text-slate-900">{cart.itemCount ?? 'Unavailable'}</dd></div>
          <div className="flex flex-wrap justify-between gap-2"><dt className="text-slate-600">Total quantity</dt><dd className="font-semibold text-slate-900">{cart.totalQuantity !== null ? `${cart.totalQuantity} pcs` : 'Unavailable'}</dd></div>
          <div className="flex flex-wrap justify-between gap-2 border-t border-slate-100 pt-3"><dt className="text-slate-600">Cart subtotal <span className="block text-[10px] text-slate-500">GST included</span></dt><dd className="break-words text-xl font-bold tracking-tight text-slate-950">{cart.subtotal !== null ? formatInr(cart.subtotal) : 'Unavailable'}</dd></div>
          <div className="flex flex-wrap justify-between gap-2 rounded-lg bg-emerald-50 px-3 py-2 text-emerald-800"><dt>Total savings <span className="text-[10px]">vs MRP</span></dt><dd className="font-semibold">{cart.savings !== null ? formatInr(cart.savings) : 'Unavailable'}</dd></div>
        </dl>
        {cart.needsReview ? <p role="status" className="mt-3 text-[11px] leading-5 text-amber-800">{cart.unavailable ? 'Some cart details could not be priced. Open your cart to review current availability and terms.' : 'Some items need a quantity or availability review before ordering.'}</p> : null}
        <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
          <Link href="/retailer/cart" className="flex min-h-11 items-center justify-center rounded-xl bg-action-600 px-3 text-xs font-semibold text-white hover:bg-action-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action-500 focus-visible:ring-offset-2">View Cart</Link>
          <Link href="/retailer/catalog" className="flex min-h-11 items-center justify-center rounded-xl border border-slate-200 px-3 text-center text-xs font-semibold text-action-700 hover:bg-action-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action-500">Continue Shopping</Link>
        </div>
        <p className="mt-3 text-[10px] leading-4 text-slate-500">Current item totals. Prices are checked again at checkout; stock is reserved on order confirmation.</p>
      </>}
    </section>
  );
}
