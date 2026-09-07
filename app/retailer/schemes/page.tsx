import Link from 'next/link';
import {
  ArrowRight,
  BadgePercent,
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  ShoppingBag,
  Sparkles,
  Tag,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { requireUser } from '@/lib/auth/session';
import { formatIndiaDate } from '@/lib/datetime/india';

interface SchemeRow {
  id: string;
  name: string;
  description: string | null;
  is_festival: boolean;
  starts_at: string;
  ends_at: string;
}

export default async function RetailerSchemesPage() {
  await requireUser();
  const supabase = createClient();
  const nowIso = new Date().toISOString();
  const { data } = await supabase
    .from('schemes')
    .select('id, name, description, is_festival, starts_at, ends_at')
    .eq('is_active', true)
    .lte('starts_at', nowIso)
    .gte('ends_at', nowIso)
    .order('ends_at')
    .returns<SchemeRow[]>();
  const schemes = data ?? [];

  return (
    <div className="space-y-6 sm:space-y-7">
      <div className="flex items-center gap-1.5 text-[10px] font-semibold text-slate-500 sm:text-xs">
        <Link href="/retailer/home" className="hover:text-primary-600">
          Home
        </Link>
        <ChevronRight className="h-3 w-3" />
        <span className="text-slate-800">Schemes &amp; offers</span>
      </div>

      <section className="relative overflow-hidden rounded-2xl border border-slate-200 bg-gradient-to-br from-primary-50 via-white to-rose-50/50 p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)] sm:p-7">
        <div className="relative max-w-2xl">
          <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.18em] text-primary-600">
            <Sparkles className="h-3.5 w-3.5" aria-hidden="true" /> Save more on every restock
          </p>
          <h1 className="mt-2 text-2xl font-bold tracking-tight text-slate-950 sm:text-3xl">Schemes &amp; offers</h1>
          <p className="mt-2 max-w-xl text-xs leading-5 text-slate-600 sm:text-sm">
            Explore the latest retailer schemes and festival offers available while you shop the Maharani Traders catalog.
          </p>
          <Link
            href="/retailer/catalog?offers=1"
            className="mt-5 inline-flex h-10 items-center gap-2 rounded-xl bg-primary-600 px-4 text-xs font-bold text-white shadow-sm transition hover:bg-primary-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-300"
          >
            Shop offer products <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Link>
        </div>
      </section>

      <section className="flex flex-col gap-3 rounded-2xl border border-primary-100 bg-primary-50/40 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white text-primary-600 shadow-sm">
            <CheckCircle2 className="h-5 w-5" aria-hidden="true" />
          </span>
          <div>
            <h2 className="text-sm font-bold text-slate-900">Applicable schemes</h2>
            <p className="mt-0.5 text-[11px] leading-4 text-slate-600">
              Eligible retailer and area pricing is applied automatically in your catalog and rechecked at checkout.
            </p>
          </div>
        </div>
        <span className="shrink-0 text-[10px] font-bold text-primary-700">
          {schemes.length} active offer{schemes.length === 1 ? '' : 's'}
        </span>
      </section>

      {schemes.length === 0 ? (
        <section className="flex min-h-[300px] flex-col items-center justify-center rounded-2xl border border-slate-200 bg-white px-5 text-center shadow-sm">
          <span className="flex h-16 w-16 items-center justify-center rounded-full bg-primary-50 text-primary-600">
            <Tag className="h-7 w-7" aria-hidden="true" />
          </span>
          <h2 className="mt-4 text-lg font-bold text-slate-900">No active schemes right now</h2>
          <p className="mt-2 max-w-sm text-xs leading-5 text-slate-500">
            New offers will appear here as soon as they are available for retailers.
          </p>
          <Link
            href="/retailer/catalog"
            className="mt-5 inline-flex h-10 items-center gap-2 rounded-xl bg-primary-600 px-4 text-xs font-bold text-white hover:bg-primary-700"
          >
            Browse catalog <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Link>
        </section>
      ) : (
        <section className="space-y-4">
          <div className="flex items-end justify-between gap-3">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-primary-600">What&rsquo;s live now</p>
              <h2 className="mt-0.5 text-lg font-bold text-slate-900 sm:text-2xl">Offers for your shop</h2>
            </div>
            <Link
              href="/retailer/catalog?offers=1"
              className="flex items-center gap-1 text-[10px] font-bold text-primary-600 sm:text-[11px]"
            >
              View all products <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
            </Link>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            {schemes.map((scheme) => (
              <article
                key={scheme.id}
                className="overflow-hidden rounded-2xl border border-slate-200 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)] sm:p-6"
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-primary-50 px-3 py-1.5 text-[9px] font-bold uppercase tracking-wider text-primary-700">
                    <Tag className="h-3 w-3" aria-hidden="true" />{' '}
                    {scheme.is_festival ? 'Festival offer' : 'Retailer scheme'}
                  </span>
                  <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-[9px] font-bold text-emerald-700">Active</span>
                </div>
                <h3 className="mt-4 max-w-sm text-lg font-bold leading-tight text-slate-900">{scheme.name}</h3>
                <p className="mt-2 max-w-md text-xs leading-5 text-slate-500">
                  {scheme.description ?? 'Enjoy eligible savings on selected products.'}
                </p>
                <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4">
                  <p className="flex items-center gap-1.5 text-[10px] font-semibold text-slate-500">
                    <CalendarDays className="h-3.5 w-3.5" aria-hidden="true" /> Valid till {formatIndiaDate(scheme.ends_at)}
                  </p>
                  <Link
                    href="/retailer/catalog?offers=1"
                    className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary-600 px-3 text-[10px] font-bold text-white transition hover:bg-primary-700"
                  >
                    View products <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                  </Link>
                </div>
              </article>
            ))}
          </div>
        </section>
      )}

      <section className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:grid-cols-3 sm:p-5">
        {[
          { icon: ShoppingBag, title: 'Shop eligible products', body: 'Use the View Products CTA to see offer-tagged items.' },
          { icon: BadgePercent, title: 'Prices stay transparent', body: 'Discounts and your approved price show in the catalog.' },
          { icon: CheckCircle2, title: 'Checkout rechecks', body: 'Every scheme is validated again before placing an order.' },
        ].map((item) => (
          <div key={item.title} className="flex items-start gap-3 rounded-xl bg-slate-50 p-3">
            <item.icon className="mt-0.5 h-5 w-5 shrink-0 text-primary-600" aria-hidden="true" />
            <div>
              <p className="text-xs font-bold text-slate-800">{item.title}</p>
              <p className="mt-1 text-[10px] leading-4 text-slate-500">{item.body}</p>
            </div>
          </div>
        ))}
      </section>
    </div>
  );
}
