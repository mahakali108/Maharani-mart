import Link from 'next/link';
import { ArrowUpRight, Boxes, PackageCheck, RotateCcw, Store } from 'lucide-react';
import { SERVICE_AREA_LABEL } from '@/lib/config/service-area';

export function AuthFrame({ children, wide = false }: { children: React.ReactNode; wide?: boolean }) {
  return <main className="auth-surface min-h-screen px-4 py-6 sm:px-8 lg:px-12 lg:py-10">
    <Link href="/login" className="inline-flex min-h-11 items-center gap-3 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-600">
      <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-lavender-100 text-lg font-bold text-primary-600">M</span>
      <span><span className="block text-base font-semibold text-slate-950">Maharani Traders</span><span className="block text-[10px] uppercase tracking-[0.16em] text-slate-500">Your everyday business partner</span></span>
    </Link>
    <div className="mx-auto mt-8 grid max-w-6xl items-center gap-8 lg:mt-14 lg:grid-cols-2 lg:gap-16">
      <aside className="hidden min-w-0 lg:block">
        <p className="shop-eyebrow flex items-center gap-2"><Store className="h-4 w-4" aria-hidden="true" /> Made for Indian retailers</p>
        <h2 className="mt-5 text-5xl font-semibold leading-[1.15] tracking-tight text-slate-950">More for your shelves.<br /><span className="text-primary-600">Less on your mind.</span></h2>
        <p className="mt-5 max-w-md text-sm leading-7 text-slate-600">Your wholesale catalogue, pack sizes, orders and reorders. Together in one simple shopping experience.</p>
        <div className="mt-8 grid grid-cols-2 gap-3">
          <div className="rounded-2xl border border-mint-200 bg-mint-100 p-5"><Boxes className="h-6 w-6 text-mint-700" aria-hidden="true" /><h3 className="mt-4 text-sm font-semibold">Stock up your way</h3><p className="mt-2 text-xs leading-5 text-slate-600">Pack sizes and minimum quantities, clearly shown.</p></div>
          <div className="rounded-2xl border border-lavender-200 bg-lavender-100 p-5"><RotateCcw className="h-6 w-6 text-lavender-700" aria-hidden="true" /><h3 className="mt-4 text-sm font-semibold">Make restocking easier</h3><p className="mt-2 text-xs leading-5 text-slate-600">Find your past orders and review a reorder.</p></div>
        </div>
        <p className="mt-6 flex items-center gap-2 text-xs text-slate-500"><PackageCheck className="h-4 w-4" aria-hidden="true" /> Initial district default: {SERVICE_AREA_LABEL} · PIN coverage verified at checkout</p>
      </aside>
      <section className={`mx-auto w-full rounded-[1.75rem] border border-slate-200 bg-white p-5 shadow-premium sm:p-8 ${wide ? 'max-w-2xl' : 'max-w-md'}`}>
        {children}
        <nav aria-label="Public information" className="mt-8 flex flex-wrap justify-center gap-x-4 gap-y-1 border-t border-slate-100 pt-5 text-[11px] text-slate-600">
          <Link href="/about" className="min-h-11 inline-flex items-center">About</Link>
          <Link href="/legal/terms" className="min-h-11 inline-flex items-center">Terms</Link>
          <Link href="/legal/privacy" className="min-h-11 inline-flex items-center">Privacy</Link>
          <Link href="/legal/shipping" className="min-h-11 inline-flex items-center">Delivery</Link>
          <Link href="/legal/returns" className="min-h-11 inline-flex items-center">Returns</Link>
          <Link href="/contact" className="min-h-11 inline-flex items-center gap-1">Contact <ArrowUpRight className="h-3 w-3" aria-hidden="true" /></Link>
        </nav>
      </section>
    </div>
  </main>;
}
