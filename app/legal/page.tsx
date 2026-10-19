import { redirect } from 'next/navigation';

/** Stable entry point for policy links; no dynamic user content is cached. */
export default function LegalIndexPage() {
  redirect('/legal/terms');
}
