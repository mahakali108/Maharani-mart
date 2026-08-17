export const CATALOG_SORTS = ['recommended', 'price-low', 'price-high', 'discount', 'newest', 'frequent', 'name'] as const;
export type CatalogSort = (typeof CATALOG_SORTS)[number];

export interface CatalogQuery {
  q?: string;
  category?: string;
  brand?: string;
  sort?: string;
  minPrice?: string;
  maxPrice?: string;
  discount?: string;
  maxMoq?: string;
  fav?: string;
  new?: string;
  offers?: string;
}

export function sanitizeSearchTerm(raw: string): string {
  return raw
    .replace(/[%_*,.()"'\\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
}

export function parseCatalogSort(value: string | undefined): CatalogSort {
  return CATALOG_SORTS.includes(value as CatalogSort) ? (value as CatalogSort) : 'recommended';
}

export function catalogHref(query: CatalogQuery): string {
  const params = new URLSearchParams();
  if (query.q) params.set('q', query.q);
  if (query.category) params.set('category', query.category);
  if (query.brand) params.set('brand', query.brand);
  if (query.sort && query.sort !== 'recommended') params.set('sort', query.sort);
  if (query.minPrice) params.set('minPrice', query.minPrice);
  if (query.maxPrice) params.set('maxPrice', query.maxPrice);
  if (query.discount) params.set('discount', query.discount);
  if (query.maxMoq) params.set('maxMoq', query.maxMoq);
  if (query.fav === '1') params.set('fav', '1');
  if (query.new === '1') params.set('new', '1');
  if (query.offers === '1') params.set('offers', '1');
  const qs = params.toString();
  return `/retailer/catalog${qs ? `?${qs}` : ''}`;
}

export function parseOptionalNumber(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
