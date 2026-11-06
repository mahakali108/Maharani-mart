import { permanentCanonicalLegalRedirect } from '@/app/legal/canonical-redirect';

export default async function TermsRedirect({ searchParams: searchParamsPromise }: { searchParams?: Promise<Record<string, string | string[] | undefined>> }) {
  const searchParams = await searchParamsPromise;
  permanentCanonicalLegalRedirect('/legal/terms', searchParams);
}
