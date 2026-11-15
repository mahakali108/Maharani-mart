import Link from 'next/link';

import { FALLBACK_FOOTER_LINKS } from '@/lib/site-content/nav';

export type InformationNavLink = { href: string; label: string };

/**
 * Accessible, responsive shell for public operational / legal information.
 *
 * Deliberately free of operator notices. An earlier version rendered a
 * publication-review banner on every page; that is internal review information,
 * it is not true for a published page, and it must never be shown to a customer.
 * It now lives only in the Super Admin dashboard (`/admin/content`), where the
 * reviewer needs it.
 */
export function PublicInfoShell({
  title,
  eyebrow,
  intro,
  children,
  version,
  effectiveDate,
  navLinks,
}: {
  title: string;
  eyebrow: string;
  intro: string;
  children: React.ReactNode;
  /** Published version of a legal document, when the page is one. */
  version?: string;
  /** Already formatted for readers (e.g. "04 November 2026"). */
  effectiveDate?: string;
  navLinks?: InformationNavLink[];
}) {
  const links = navLinks ?? FALLBACK_FOOTER_LINKS;
  return (
    <div className="min-h-screen bg-ivory-50 text-slate-900">
      <header className="border-b border-slate-200 bg-white/95">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-2 px-4 py-3 sm:px-6">
          <Link
            href="/login"
            className="inline-flex min-h-11 items-center gap-3 rounded-lg text-sm font-bold text-primary-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
          >
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-lavender-100 text-lg">M</span>
            Maharani Traders
          </Link>
          <Link
            href="/login"
            className="inline-flex min-h-11 items-center rounded-xl border border-slate-200 px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50"
          >
            Sign in
          </Link>
        </div>
      </header>
      <main className="mx-auto max-w-5xl space-y-6 px-4 py-8 sm:px-6 sm:py-12">
        <div className="max-w-3xl">
          <p className="shop-eyebrow">{eyebrow}</p>
          <h1 className="shop-heading mt-2 text-3xl font-semibold sm:text-4xl">{title}</h1>
          <p className="mt-3 text-sm leading-7 text-slate-600 sm:text-base">{intro}</p>
          {version && effectiveDate ? (
            <dl className="mt-4 flex flex-wrap gap-x-6 gap-y-1 text-xs text-slate-600" aria-label="Document version">
              <div className="flex gap-1.5"><dt className="font-semibold text-slate-700">Version</dt><dd>{version}</dd></div>
              <div className="flex gap-1.5"><dt className="font-semibold text-slate-700">Effective date</dt><dd>{effectiveDate}</dd></div>
            </dl>
          ) : null}
        </div>
        <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_220px] md:items-start">
          <div className="space-y-4">{children}</div>
          <nav aria-label="Information pages" className="rounded-2xl border border-slate-200 bg-white p-4 md:sticky md:top-6">
            <h2 className="text-xs font-bold uppercase tracking-widest text-slate-500">Information</h2>
            <ul className="mt-2 grid grid-cols-2 gap-1 md:grid-cols-1">
              {links.map((item) => (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    className="flex min-h-11 items-center rounded-xl px-3 text-sm font-medium text-primary-700 hover:bg-lavender-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
                  >
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        </div>
      </main>
      <footer className="border-t border-slate-200 bg-white px-4 py-7 text-center text-xs text-slate-500">
        <nav aria-label="Policy links" className="mx-auto flex max-w-5xl flex-wrap justify-center gap-x-4 gap-y-1">
          {links
            .filter((item) => item.href.startsWith('/legal/'))
            .map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="inline-flex min-h-11 items-center text-primary-700 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
              >
                {item.label}
              </Link>
            ))}
        </nav>
        <p className="mt-2">Maharani Traders · Availability depends on verified service PINs.</p>
      </footer>
    </div>
  );
}

/**
 * Re-exported for existing callers. The list itself lives in
 * `lib/site-content/nav.ts` so every footer and the public information shell
 * share one fallback; it is navigation only and carries no page content.
 */
export const DEFAULT_LINKS = FALLBACK_FOOTER_LINKS;

export function InfoCard({ title, children, tone = 'standard' }: { title: string; children: React.ReactNode; tone?: 'standard' | 'highlight' }) {
  return (
    <section
      className={
        tone === 'highlight'
          ? 'rounded-2xl border border-lavender-200 bg-lavender-50/60 p-5 shadow-sm sm:p-6'
          : 'rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6'
      }
    >
      <h2 className="text-base font-bold text-slate-900">{title}</h2>
      <div className="mt-3 space-y-3 text-sm leading-7 text-slate-600">{children}</div>
    </section>
  );
}
