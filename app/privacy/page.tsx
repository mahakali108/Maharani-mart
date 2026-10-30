import { permanentCanonicalLegalRedirect } from '@/app/legal/canonical-redirect';

export default function PrivacyRedirect({ searchParams }: { searchParams?: Record<string, string | string[] | undefined> }) {
  permanentCanonicalLegalRedirect('/legal/privacy', searchParams);
}
