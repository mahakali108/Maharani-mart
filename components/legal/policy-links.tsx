import Link from 'next/link';

import type { FooterLink } from '@/lib/site-content/types';

/**
 * Presentational footer link list. The links are passed in by the surrounding
 * server layout from `loadFooterLinks()` (managed website content), so this
 * component holds no page list of its own and cannot drift from /admin/content.
 *
 * Client-safe: only `next/link`, no database access, so staff and salesman
 * shells can render it inside their client components.
 */
export function PolicyLinks({
  links,
  ariaLabel = 'Policy links',
  className = 'flex flex-wrap gap-x-4 gap-y-1',
  linkClassName = 'inline-flex min-h-11 items-center text-xs text-ink-600 hover:text-primary-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500',
}: {
  links: FooterLink[];
  ariaLabel?: string;
  className?: string;
  linkClassName?: string;
}) {
  if (links.length === 0) return null;
  return (
    <nav aria-label={ariaLabel} className={className}>
      {links.map(({ href, label }) => (
        <Link key={href} href={href} className={linkClassName}>
          {label}
        </Link>
      ))}
    </nav>
  );
}
