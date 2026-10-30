import { permanentRedirect } from 'next/navigation';

type SearchParams = Record<string, string | string[] | undefined>;

/**
 * Redirect legacy public policy URLs to their single canonical `/legal/*` URL.
 * Query parameters are retained so links from external notices or campaigns do
 * not silently lose their context.
 */
export function permanentCanonicalLegalRedirect(canonicalPath: string, searchParams: SearchParams = {}) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(searchParams)) {
    if (typeof value === 'string') {
      query.append(key, value);
    } else if (Array.isArray(value)) {
      for (const entry of value) query.append(key, entry);
    }
  }
  const suffix = query.toString();
  permanentRedirect(suffix ? `${canonicalPath}?${suffix}` : canonicalPath);
}
