'use client';

/**
 * The shared infinite-scroll machinery.
 *
 * Every list in the app (catalog, orders, inventory, notifications, ledger…)
 * used to render `?page=N` links with a "Page 1 of 7" label and Previous/Next
 * buttons. All of that is gone. A list page now:
 *
 *   1. renders its FIRST batch on the server (fast first paint, no spinner on
 *      load, fully crawlable markup),
 *   2. hands a Server Action to `useInfiniteList` (directly, or through
 *      <InfiniteScrollProvider>) that fetches the NEXT batch,
 *   3. appends each batch as the user approaches the bottom.
 *
 * Two ways to use it, one state machine underneath:
 *
 *   - <InfiniteScrollProvider> + <InfiniteScrollRows> + <InfiniteScrollStatus>
 *     for lists whose rows are rendered on the server. The page keeps all of
 *     its own markup (tables, cards, filters) and simply drops these in.
 *   - `useInfiniteList` directly, for a Client Component that must OWN its
 *     rows — e.g. the admin product table, where each row keeps a selection
 *     checkbox and per-row actions.
 *
 * Mobile behaviour this file owns:
 *   - batches load BEFORE the user hits the bottom (rootMargin), so scrolling
 *     never stalls on Android's slower WebView,
 *   - only one request is ever in flight,
 *   - a failed batch shows a Retry button instead of looping,
 *   - rows are appended below the fold, so the scroll position never jumps,
 *   - filter/search/sort changes reset the list instead of appending onto a
 *     stale result set.
 */

import {
  createContext,
  Fragment,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { Loader2, RotateCw } from 'lucide-react';
import { isCursorAdvancing } from '@/lib/infinite-scroll/cursor';
import { cn } from '@/lib/utils/cn';

/** One batch of already-rendered rows, as returned by a row-level loader. */
export interface InfiniteScrollBatch {
  /** Rows for this batch, rendered on the server. */
  rows: ReactNode[];
  /** Cursor for the next batch, or `null` when the list is complete. */
  nextCursor: string | null;
}

export type InfiniteScrollLoader = (cursor: string | null) => Promise<InfiniteScrollBatch>;

/** The live state of a scrolling list. */
export interface InfiniteListState<T> {
  /** Everything loaded after the server-rendered first batch. */
  items: T[];
  loading: boolean;
  error: string | null;
  hasMore: boolean;
  /** Fetch the next batch. No-op when one is already in flight. */
  loadMore: () => void;
  /** Clear a failed batch and fetch it again. */
  retry: () => void;
  /** Attach the viewport sentinel rendered by <InfiniteScrollStatus>. */
  registerSentinel: (node: HTMLElement | null) => void;
  /** True when the browser has no IntersectionObserver (manual fallback). */
  needsManualTrigger: boolean;
}

export interface UseInfiniteListOptions<T> {
  /** Server Action: returns the batch after `cursor`. */
  loader: (cursor: string | null) => Promise<{ items: T[]; nextCursor: string | null }>;
  /** Cursor for the batch after the server-rendered one; null if it is the last. */
  initialCursor?: string | null;
  /** Whether a batch exists after the server-rendered one. */
  initialHasMore?: boolean;
  /**
   * Changing this resets the list. Pass the active filter/search/sort state so
   * a new query never appends onto the rows of the previous one.
   */
  resetKey?: string;
  /** How far before the bottom loading starts. Generous on purpose (mobile). */
  rootMargin?: string;
}

// Browser support for IntersectionObserver never changes while a page is open.
function subscribeToNothing(): () => void {
  return () => {};
}
function lacksIntersectionObserver(): boolean {
  return typeof IntersectionObserver === 'undefined';
}
function assumeIntersectionObserver(): boolean {
  return false;
}

/**
 * The one state machine behind every scrolling list.
 *
 * `T` is a single batch: `ReactNode[]` when the server renders the rows, or a
 * serialisable row type when a Client Component renders them.
 */
export function useInfiniteList<T>({
  loader,
  initialCursor = null,
  initialHasMore = false,
  resetKey,
  rootMargin = '800px 0px',
}: UseInfiniteListOptions<T>): InfiniteListState<T> {
  const [items, setItems] = useState<T[]>([]);
  const [cursor, setCursor] = useState<string | null>(initialCursor);
  const [hasMore, setHasMore] = useState(initialHasMore);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sentinel, setSentinel] = useState<HTMLElement | null>(null);
  // False on the server and during hydration, then the real answer in the browser.
  const needsManualTrigger = useSyncExternalStore(subscribeToNothing, lacksIntersectionObserver, assumeIntersectionObserver);

  // A filter/search/sort change re-renders the page on the server: the
  // server-rendered rows change, so anything appended before must be dropped.
  // Resetting during render (not in an effect) avoids one painted frame of
  // stale rows on a slow Android device.
  const [activeKey, setActiveKey] = useState(resetKey);
  if (activeKey !== resetKey) {
    setActiveKey(resetKey);
    setItems([]);
    setCursor(initialCursor);
    setHasMore(initialHasMore);
    setLoading(false);
    setError(null);
  }

  // Refs keep `loadMore` stable so the observer is not torn down every render.
  const cursorRef = useRef(cursor);
  const hasMoreRef = useRef(hasMore);
  const errorRef = useRef(error);
  const inFlightRef = useRef(false);
  const loaderRef = useRef(loader);
  // Synchronised after every commit (never during render). This effect is
  // declared before the observer effect below, so the refs are current before
  // any `loadMore` that the observer or a click can start.
  useEffect(() => {
    cursorRef.current = cursor;
    hasMoreRef.current = hasMore;
    errorRef.current = error;
    loaderRef.current = loader;
  });

  const loadMore = useCallback(async () => {
    if (inFlightRef.current) return;
    if (!hasMoreRef.current || errorRef.current) return;
    inFlightRef.current = true;
    setLoading(true);
    setError(null);
    const requestCursor = cursorRef.current;
    try {
      const batch = await loaderRef.current(requestCursor);
      const nextItems = batch?.items ?? [];
      const nextCursor = batch?.nextCursor ?? null;
      if (nextItems.length === 0) {
        // Nothing came back: stop asking instead of looping forever.
        setHasMore(false);
        return;
      }
      if (!isCursorAdvancing(requestCursor, nextCursor)) {
        // The batch repeated the cursor it was fetched with. Appending it would
        // duplicate rows already on screen and re-requesting it would loop
        // forever, so the list ends here — a broken cursor must never become an
        // infinite spinner.
         
        console.warn('[infinite-scroll] loader returned a non-advancing cursor; stopping the list.');
        setHasMore(false);
        return;
      }
      setItems((previous) => [...previous, ...nextItems]);
      setCursor(nextCursor);
      setHasMore(Boolean(nextCursor));
    } catch (cause) {
      setError(cause instanceof Error && cause.message ? cause.message : 'Could not load more.');
    } finally {
      inFlightRef.current = false;
      setLoading(false);
    }
  }, []);

  const retry = useCallback(() => {
    errorRef.current = null;
    setError(null);
    void loadMore();
  }, [loadMore]);

  // Re-created after every batch: if the sentinel is still on screen (a short
  // list, or a tall phone) the fresh observer fires immediately and the list
  // keeps filling until the sentinel is pushed below the fold.
  useEffect(() => {
    if (!sentinel || typeof IntersectionObserver === 'undefined') return;
    if (!hasMore || loading || error) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) void loadMore();
      },
      { rootMargin }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [sentinel, hasMore, loading, error, loadMore, rootMargin]);

  return {
    items,
    loading,
    error,
    hasMore,
    loadMore: () => void loadMore(),
    retry,
    registerSentinel: setSentinel,
    needsManualTrigger,
  };
}

const InfiniteScrollContext = createContext<InfiniteListState<ReactNode[]> | null>(null);

/** Read the list state provided by the nearest <InfiniteScrollProvider>. */
export function useInfiniteScroll(): InfiniteListState<ReactNode[]> {
  const context = useContext(InfiniteScrollContext);
  if (!context) {
    throw new Error('Infinite scroll components must be rendered inside <InfiniteScrollProvider>.');
  }
  return context;
}

/**
 * Provider for server-rendered lists: it hands `loader` to the shared state
 * machine and makes the loaded batches available to <InfiniteScrollRows>
 * (anywhere inside the list markup — including inside a <tbody>) and to
 * <InfiniteScrollStatus>.
 */
export function InfiniteScrollProvider({
  loader,
  initialCursor = null,
  initialHasMore = false,
  resetKey,
  rootMargin,
  children,
}: {
  /** Server Action: returns the batch after `cursor` as rendered rows. */
  loader: InfiniteScrollLoader;
  initialCursor?: string | null;
  initialHasMore?: boolean;
  resetKey?: string;
  rootMargin?: string;
  children: ReactNode;
}) {
  const state = useInfiniteList<ReactNode[]>({
    // A row-level loader returns one batch as `{ rows }`; each item the state
    // machine appends is itself one batch of rows.
    loader: async (cursor) => {
      const batch = await loader(cursor);
      const rows = Array.isArray(batch.rows) ? batch.rows : [batch.rows];
      // A batch with nothing to render ends the list, whatever cursor came
      // with it: appending an empty fragment and asking for more is the other
      // way a list can spin forever ("Loading more…" with no rows arriving).
      if (rows.length === 0) return { items: [], nextCursor: null };
      return { items: [rows], nextCursor: batch.nextCursor };
    },
    initialCursor,
    initialHasMore,
    resetKey,
    rootMargin,
  });
  return <InfiniteScrollContext.Provider value={state}>{children}</InfiniteScrollContext.Provider>;
}

/**
 * Renders the list body: the server-rendered first batch, then every batch
 * loaded since, then (while a batch is in flight) the skeleton.
 */
export function InfiniteScrollRows({
  children,
  skeleton,
}: {
  /** The server-rendered first batch. */
  children: ReactNode;
  /** Placeholder rows shown while the next batch is loading. */
  skeleton?: ReactNode;
}) {
  const { items, loading } = useInfiniteScroll();
  return (
    <>
      {children}
      {items.map((rows, index) => (
        <Fragment key={`batch-${index}`}>{rows}</Fragment>
      ))}
      {loading && skeleton ? skeleton : null}
    </>
  );
}

/**
 * The viewport sentinel and everything the user sees at the end of a list:
 * a small spinner while loading, a retry affordance after a failure, and a
 * plain end-of-list line once the last row has loaded. Never a page number.
 */
export function InfiniteScrollStatus({
  state,
  endLabel = 'No more items',
  loadingLabel = 'Loading more…',
  className,
}: {
  /** Omit to read the surrounding <InfiniteScrollProvider>; pass it when a
   *  Client Component owns the list state itself. */
  state?: InfiniteListState<unknown>;
  endLabel?: string;
  loadingLabel?: string;
  className?: string;
}) {
  const context = useContext(InfiniteScrollContext);
  const active = (state as InfiniteListState<unknown> | undefined) ?? context;

  return (
    <div className={cn('flex flex-col items-center gap-2 py-4 text-center', className)}>
      {/* Zero-height sentinel: purely a viewport probe, never visible. */}
      <div
        ref={active?.registerSentinel}
        aria-hidden="true"
        className="h-px w-full"
        data-infinite-scroll-sentinel=""
      />
      <div role="status" aria-live="polite" className="flex min-h-[28px] items-center justify-center">
        {!active ? null : active.loading ? (
          <span className="flex items-center gap-2 text-xs font-medium text-ink-400">
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
            {loadingLabel}
          </span>
        ) : active.error ? (
          <span className="flex flex-wrap items-center justify-center gap-2 text-xs text-ink-500">
            <span>{active.error}</span>
            <button
              type="button"
              onClick={active.retry}
              className="inline-flex items-center gap-1 rounded-lg border border-ink-200 px-2.5 py-1 text-xs font-semibold text-ink-700 transition hover:border-primary-200 hover:text-primary-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-300"
            >
              <RotateCw className="h-3 w-3" aria-hidden="true" />
              Retry
            </button>
          </span>
        ) : active.hasMore ? (
          // No IntersectionObserver (very old WebView): keep the list usable
          // with a single tap rather than dead-ending the page.
          active.needsManualTrigger ? (
            <button
              type="button"
              onClick={() => void active.retry()}
              className="rounded-lg border border-ink-200 px-3 py-1.5 text-xs font-semibold text-ink-700 transition hover:border-primary-200 hover:text-primary-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-300"
            >
              Load more
            </button>
          ) : null
        ) : (
          <span className="text-xs text-ink-400">{endLabel}</span>
        )}
      </div>
    </div>
  );
}

/** Reusable skeleton rows for table-shaped lists. */
export function InfiniteScrollTableSkeleton({ columns, rows = 3 }: { columns: number; rows?: number }) {
  return (
    <>
      {Array.from({ length: rows }).map((_, row) => (
        <tr key={`skeleton-${row}`} aria-hidden="true">
          {Array.from({ length: columns }).map((__, column) => (
            <td key={column} className="px-5 py-3">
              <span className="block h-3 animate-pulse rounded bg-ink-100" />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}
