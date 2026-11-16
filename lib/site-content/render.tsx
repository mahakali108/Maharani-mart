import Link from 'next/link';
import type { ReactNode } from 'react';
import { isSafePublicLink } from './types';

/**
 * Renders the small amount of inline markup a Super Admin may type in a
 * paragraph: `[label](/path)` links and nothing else.
 *
 * Why not a markdown library: the content is edited by one trusted role, but it
 * is rendered on public pages. Supporting the narrowest thing that the existing
 * policy text needed (a link inside a sentence) means there is no HTML path, no
 * `dangerouslySetInnerHTML`, and nothing a pasted `<script>` can become. A link
 * whose destination fails `isSafePublicLink` stays visible as text instead of
 * becoming a `javascript:` URL.
 */
const LINK = /\[([^\]]{1,200})\]\(([^)\s]{1,2048})\)/g;

export function renderRichText(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  LINK.lastIndex = 0;

  while ((match = LINK.exec(text)) !== null) {
    const whole = match[0];
    const label = match[1] ?? '';
    const href = match[2] ?? '';
    if (match.index > lastIndex) nodes.push(text.slice(lastIndex, match.index));
    if (isSafePublicLink(href)) {
      const className = 'font-semibold text-primary-700 underline underline-offset-2';
      nodes.push(
        href.startsWith('/') ? (
          <Link key={`${match.index}-${href}`} href={href} className={className}>
            {label}
          </Link>
        ) : (
          <a
            key={`${match.index}-${href}`}
            href={href}
            className={className}
            {...(href.startsWith('http') ? { rel: 'noopener noreferrer', target: '_blank' } : {})}
          >
            {label}
          </a>
        ),
      );
    } else {
      nodes.push(label);
    }
    lastIndex = match.index + whole.length;
  }

  if (lastIndex < text.length) nodes.push(text.slice(lastIndex));
  return nodes;
}

/** `2026-11-04` -> `04 November 2026` (the format the policy pages always used). */
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export function formatPolicyDate(value: string | null | undefined): string {
  if (!value) return '';
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!match) return value;
  const month = MONTHS[Number(match[2]) - 1];
  if (!month) return value;
  return `${match[3]} ${month} ${match[1]}`;
}
