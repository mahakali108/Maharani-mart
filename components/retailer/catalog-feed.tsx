'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, RotateCcw } from 'lucide-react';
import { CompareGrid } from '@/components/retailer/compare-grid';
import type { PricedCatalogCard } from '@/lib/retailer/catalog';
import { catalogFeedHref, catalogFeedKey, type CatalogQuery } from '@/lib/retailer/catalog-params';

/**
 * Continuous (infinite-scroll) catalog list for the mobile storefront.
 *
 * - The FIRST batch is server-rendered by the catalog page, so opening the
 *   catalog is as fast as it was before; this component appends to it.
 * - Later batches come from `/api/retailer/catalog`, which re-runs the exact
 *   same server-side loader (filters, sort, pricing, RLS) — the client only
 *   supplies a cursor.
 * - It stops asking when the server says there is nothing left, never requests
 *   the same cursor twice, and de-duplicates by product id.
 * - There are no page numbers and no "Next" button: the list simply continues.
 *
 * The parent MUST pass a React `key` that changes with the filter state (see
 * `catalogFeedKey`) so a filter/sort change remounts this component onto the
 * newly server-rendered first batch instead of keeping a stale list.
 */
export interface CatalogFeedState {
  cards: PricedCatalogCard[];
  total: number;
  offset: number;
  limit: number;
  nextOffset: number | null;
  hasMore: boolean;
  workingSetCapped: boolean;
  feedCapped: boolean;
}

const STORAGE_KEY = 'maharani.catalogFeed.v1';
/** Refuse to persist a feed that would blow the ~5 MB sessionStorage budget. */
const STORAGE_MAX_CHARS = 900_000;
/** Start the next batch this far before the sentinel scrolls into view. */
const PREFETCH_MARGIN_PX = 600;

export function CatalogFeed({
  initial,
  query,
}: {
  initial: CatalogFeedState;
  query: CatalogQuery;
}) {
  const key = catalogFeedKey(query);
  const [state, setState] = useState<CatalogFeedState>(initial);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const inFlightRef = useRef(false);
  const errorRef = useRef(false);
  const stateRef = useRef(state);
  const queryRef = useRef(query);
  stateRef.current = state;
  queryRef.current = query;

  // Returning from a product page (or any back/forward navigation) remounts the
  // catalog. Session storage restores how far this retailer had already
  // scrolled for THESE filters, so the list does not silently shrink to one
  // batch under them. Storage is best-effort and never blocks rendering.
  useEffect(() => {
    try {
      const raw = window.sessionStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw) as Partial<CatalogFeedState> & { key?: string };
      if (saved?.key !== key || !Array.isArray(saved.cards)) return;
      if (saved.cards.length <= initial.cards.length) return;
      setState({
        cards: saved.cards,
        total: saved.total ?? initial.total,
        offset: saved.offset ?? initial.offset,
        limit: saved.limit ?? initial.limit,
        nextOffset: saved.nextOffset ?? null,
        hasMore: saved.hasMore ?? false,
        workingSetCapped: saved.workingSetCapped ?? false,
        feedCapped: saved.feedCapped ?? false,
      });
    } catch {
      // Corrupt, disabled or full storage: keep the server's first batch.
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  useEffect(() => {
    try {
      const payload = JSON.stringify({ key, ...state });
      if (payload.length > STORAGE_MAX_CHARS) return;
      window.sessionStorage.setItem(STORAGE_KEY, payload);
    } catch {
      // Private mode / quota exceeded: continuous loading still works.
    }
  }, [key, state]);

  const loadMore = useCallback(async () => {
    if (inFlightRef.current || errorRef.current) return;
    const next = stateRef.current.nextOffset;
    // No cursor = the server already told us the list is finished.
    if (next === null) return;
    inFlightRef.current = true;
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(catalogFeedHref(queryRef.current, next), {
        headers: { accept: 'application/json' },
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = (await response.json()) as Partial<CatalogFeedState>;
      if (!Array.isArray(payload.cards)) throw new Error('Unexpected response');
      setState((previous) => {
        // De-duplicate: a row can only ever appear once, even if a batch
        // overlaps (e.g. a product was inserted while the retailer scrolled).
        const seen = new Set(previous.cards.map((card) => card.id));
        const appended = payload.cards!.filter((card) => !seen.has(card.id));
        return {
          cards: appended.length ? [...previous.cards, ...appended] : previous.cards,
          total: payload.total ?? previous.total,
          offset: payload.offset ?? previous.offset,
          limit: payload.limit ?? previous.limit,
          nextOffset: payload.nextOffset ?? null,
          hasMore: payload.hasMore ?? false,
          workingSetCapped: payload.workingSetCapped ?? previous.workingSetCapped,
          feedCapped: payload.feedCapped ?? previous.feedCapped,
        };
      });
    } catch {
      errorRef.current = true;
      setError('Could not load more products. Check your connection and try again.');
    } finally {
      inFlightRef.current = false;
      setLoading(false);
    }
  }, []);

  function retry() {
    errorRef.current = false;
    setError(null);
    void loadMore();
  }

  // Scroll-driven loading: the sentinel sits below the last row.
  useEffect(() => {
    const node = sentinelRef.current;
    if (!node || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) void loadMore();
      },
      { rootMargin: `${PREFETCH_MARGIN_PX}px 0px` }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [loadMore]);

  // Self-heal: after a batch lands, the sentinel may STILL be on screen (short
  // list, restored scroll position, tall viewport). IntersectionObserver does
  // not re-fire for a node that is already intersecting, so check it directly.
  useEffect(() => {
    if (loading || error || state.nextOffset === null) return;
    const handle = window.setTimeout(() => {
      const node = sentinelRef.current;
      if (!node) return;
      if (node.getBoundingClientRect().top <= window.innerHeight + PREFETCH_MARGIN_PX) void loadMore();
    }, 80);
    return () => window.clearTimeout(handle);
  }, [loading, error, state.nextOffset, state.cards.length, loadMore]);

  const finished = !loading && !error && state.nextOffset === null;

  return (
    <div className="min-w-0 space-y-3">
      <CompareGrid cards={state.cards} />

      {/* Zero-height trigger: it never affects layout or the fixed bottom nav. */}
      <div ref={sentinelRef} aria-hidden="true" className="h-px w-full" />

      <div className="flex min-h-[3.5rem] flex-col items-center justify-center gap-2 px-1 pb-1 text-center">
        {loading ? (
          <p role="status" className="flex items-center gap-2 text-xs font-semibold text-slate-500">
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> Loading more products…
          </p>
        ) : null}

        {error ? (
          <div className="flex flex-col items-center gap-1.5">
            <p role="alert" className="text-xs text-rose-700">
              {error}
            </p>
            <button
              type="button"
              onClick={retry}
              className="inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-4 text-xs font-semibold text-action-700 transition hover:border-action-300 hover:bg-action-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action-500"
            >
              <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" /> Try again
            </button>
          </div>
        ) : null}

        {state.feedCapped ? (
          <p className="w-full rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-[11px] leading-4 text-amber-800">
            You have reached the end of this browse list. Narrow the search or pick a category to see the rest.
          </p>
        ) : null}

        {finished ? (
          <p className="text-xs text-slate-500">
            {state.total > 0
              ? `You've reached the end — ${state.total} product${state.total === 1 ? '' : 's'} in this list.`
              : 'No more products to load.'}
          </p>
        ) : null}
      </div>
    </div>
  );
}
