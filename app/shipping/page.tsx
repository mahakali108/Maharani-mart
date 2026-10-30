import { permanentCanonicalLegalRedirect } from '@/app/legal/canonical-redirect';

export default function ShippingRedirect({ searchParams }: { searchParams?: Record<string, string | string[] | undefined> }) {
  permanentCanonicalLegalRedirect('/legal/shipping', searchParams);
}
