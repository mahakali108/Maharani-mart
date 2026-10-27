import Link from 'next/link';

const links = [
  { href: '/about', label: 'About' },
  { href: '/legal/terms', label: 'Terms' },
  { href: '/legal/privacy', label: 'Privacy' },
  { href: '/legal/shipping', label: 'Delivery' },
  { href: '/legal/returns', label: 'Returns' },
  { href: '/legal/grievance', label: 'Grievance' },
  { href: '/contact', label: 'Contact' },
];

/** Accessible, responsive shell for public operational/legal information.
 * No invented legal-entity address, GSTIN, phone number or named officer. */
export function PublicInfoShell({ title, eyebrow, intro, children }: {
  title: string;
  eyebrow: string;
  intro: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-ivory-50 text-slate-900">
      <header className="border-b border-slate-200 bg-white/95">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-2 px-4 py-3 sm:px-6">
          <Link href="/login" className="inline-flex min-h-11 items-center gap-3 rounded-lg text-sm font-bold text-primary-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-lavender-100 text-lg">M</span>Maharani Traders
          </Link>
          <Link href="/login" className="inline-flex min-h-11 items-center rounded-xl border border-slate-200 px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50">Sign in</Link>
        </div>
      </header>
      <main className="mx-auto max-w-5xl space-y-6 px-4 py-8 sm:px-6 sm:py-12">
        <div className="max-w-3xl">
          <p className="shop-eyebrow">{eyebrow}</p>
          <h1 className="shop-heading mt-2 text-3xl font-semibold sm:text-4xl">{title}</h1>
          <p className="mt-3 text-sm leading-7 text-slate-600 sm:text-base">{intro}</p>
        </div>
        <div role="note" className="rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4 text-sm leading-6 text-amber-950">
          <strong>Publication review required.</strong> Legal entity identity, verified public contact and grievance details, tax/invoice responsibility, any final commercial timelines and the policies below require business and Indian legal/tax review before launch. This page does not replace applicable law or an agreed order record.
        </div>
        <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_220px] md:items-start">
          <div className="space-y-4">{children}</div>
          <nav aria-label="Information pages" className="rounded-2xl border border-slate-200 bg-white p-4 md:sticky md:top-6">
            <h2 className="text-xs font-bold uppercase tracking-widest text-slate-500">Information</h2>
            <ul className="mt-2 grid grid-cols-2 gap-1 md:grid-cols-1">
              {links.map((item) => <li key={item.href}><Link href={item.href} className="flex min-h-11 items-center rounded-xl px-3 text-sm font-medium text-primary-700 hover:bg-lavender-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500">{item.label}</Link></li>)}
            </ul>
          </nav>
        </div>
      </main>
      <footer className="border-t border-slate-200 bg-white px-4 py-7 text-center text-xs text-slate-500">
        Maharani Traders · B2B wholesale web app · Order availability depends on verified service PINs.
      </footer>
    </div>
  );
}

export function InfoCard({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6"><h2 className="text-base font-bold text-slate-900">{title}</h2><div className="mt-3 space-y-3 text-sm leading-7 text-slate-600">{children}</div></section>;
}
