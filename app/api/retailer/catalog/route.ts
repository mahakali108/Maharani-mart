import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { loadCatalogFeed } from '@/lib/retailer/catalog-feed';
import { catalogFeedKey, type CatalogQuery } from '@/lib/retailer/catalog-params';

/**
 * Retailer catalog feed — the "load the next batch" endpoint behind the mobile
 * catalog's continuous browsing.
 *
 * GET /api/retailer/catalog?<same filters as /retailer/catalog>&offset=24
 *
 * The first batch is rendered on the server by the catalog page itself (fast
 * first paint, no spinner); every later batch comes from here. Both call the
 * same `loadCatalogFeed()` so a batch can never disagree with page 1.
 *
 * Security
 *  - The Supabase client is the request's cookie-session client: RLS governs
 *    every row exactly as it does on the page. No service-role key, ever.
 *  - An anonymous caller is rejected with 401 and a non-retailer session with
 *    403 (the catalog page is gated by middleware + the retailer layout; this
 *    is the same rule, re-stated for the JSON surface).
 *  - All filter/sort values are re-parsed and re-validated by the shared loader.
 *    `offset` is clamped server-side, so a client cannot walk the whole catalog
 *    into the browser and `limit` is fixed (a client cannot raise it).
 */
export const dynamic = 'force-dynamic';

function readQuery(params: URLSearchParams): CatalogQuery {
  return {
    q: params.get('q') ?? undefined,
    category: params.get('category') ?? undefined,
    brand: params.get('brand') ?? undefined,
    sort: params.get('sort') ?? undefined,
    minPrice: params.get('minPrice') ?? undefined,
    maxPrice: params.get('maxPrice') ?? undefined,
    discount: params.get('discount') ?? undefined,
    maxMoq: params.get('maxMoq') ?? undefined,
    fav: params.get('fav') ?? undefined,
    new: params.get('new') ?? undefined,
    offers: params.get('offers') ?? undefined,
  };
}

export async function GET(request: NextRequest) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: { 'cache-control': 'no-store' } });
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .maybeSingle<{ role: string }>();
  if (profile?.role !== 'retailer') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403, headers: { 'cache-control': 'no-store' } });
  }

  const { data: retailer } = await supabase
    .from('retailers')
    .select('area_id')
    .eq('id', user.id)
    .maybeSingle<{ area_id: string | null }>();

  const query = readQuery(request.nextUrl.searchParams);

  try {
    const feed = await loadCatalogFeed({
      supabase,
      retailerId: user.id,
      areaId: retailer?.area_id ?? null,
      query,
      offset: request.nextUrl.searchParams.get('offset') ?? undefined,
    });

    // Only the feed payload crosses the wire — taxonomy/flags the client
    // already has are not re-sent for every batch.
    return NextResponse.json(
      {
        key: catalogFeedKey(query),
        cards: feed.cards,
        total: feed.total,
        offset: feed.offset,
        limit: feed.limit,
        nextOffset: feed.nextOffset,
        hasMore: feed.hasMore,
        workingSetCapped: feed.workingSetCapped,
        feedCapped: feed.feedCapped,
        mode: feed.mode,
      },
      { headers: { 'cache-control': 'no-store' } }
    );
  } catch {
    // A failed batch is a failed batch: the client shows a retry, never a
    // fabricated product or a partial list presented as complete.
    return NextResponse.json({ error: 'Could not load products' }, { status: 500, headers: { 'cache-control': 'no-store' } });
  }
}
