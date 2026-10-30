import { permanentCanonicalLegalRedirect } from '@/app/legal/canonical-redirect';

export default function ReturnsRedirect({ searchParams }: { searchParams?: Record<string, string | string[] | undefined> }) {
  permanentCanonicalLegalRedirect('/legal/returns', searchParams);
}
