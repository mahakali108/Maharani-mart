import { permanentCanonicalLegalRedirect } from '@/app/legal/canonical-redirect';

export default function TermsRedirect({ searchParams }: { searchParams?: Record<string, string | string[] | undefined> }) {
  permanentCanonicalLegalRedirect('/legal/terms', searchParams);
}
