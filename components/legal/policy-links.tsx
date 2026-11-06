import Link from 'next/link';

const policies = [
  { href: '/legal/terms', label: 'Terms' },
  { href: '/legal/privacy', label: 'Privacy' },
  { href: '/legal/shipping', label: 'Delivery' },
  { href: '/legal/returns', label: 'Returns' },
  { href: '/legal/grievance', label: 'Grievance' },
  { href: '/legal/product-safety', label: 'Product safety' },
  { href: '/legal/business-disclosure', label: 'Business disclosure' },
];

export function PolicyLinks() {
  return (
    <nav aria-label="Policy links" className="flex flex-wrap gap-x-4 gap-y-1">
      {policies.map(({ href, label }) => (
        <Link key={href} href={href} className="inline-flex min-h-11 items-center text-xs text-ink-600 hover:text-primary-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500">{label}</Link>
      ))}
    </nav>
  );
}
