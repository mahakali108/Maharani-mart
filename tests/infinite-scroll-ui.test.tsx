// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import {
  InfiniteScrollProvider,
  InfiniteScrollRows,
  InfiniteScrollStatus,
  type InfiniteScrollBatch,
} from '@/components/ui/infinite-scroll';
import { encodeCursor } from '@/lib/infinite-scroll/cursor';

/**
 * Behaviour tests for the shared scrolling list: batches append as the user
 * approaches the bottom, requests never overlap, a failure offers a retry, and
 * a filter change starts a new list instead of appending onto the old one.
 *
 * These replace the old "renders a Page 1 of N footer" assertions.
 */

type ObserverCallback = (entries: { isIntersecting: boolean }[]) => void;

let observerCallbacks: ObserverCallback[] = [];
let disconnectCount = 0;

class FakeIntersectionObserver {
  constructor(private callback: ObserverCallback) {
    observerCallbacks.push(callback);
  }
  observe() {
    /* the fake only needs the callback */
  }
  unobserve() {
    /* no-op */
  }
  disconnect() {
    disconnectCount += 1;
  }
  takeRecords() {
    return [];
  }
  readonly root = null;
  readonly rootMargin = '';
  readonly thresholds: readonly number[] = [];
}

/** Scroll to the bottom: every live observer reports the sentinel on screen. */
function scrollToBottom() {
  const pending = observerCallbacks;
  observerCallbacks = [];
  act(() => {
    for (const callback of pending) callback([{ isIntersecting: true }]);
  });
}

beforeEach(() => {
  observerCallbacks = [];
  disconnectCount = 0;
  vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

interface HarnessOptions {
  batches: string[][];
  failOnce?: boolean;
  resetKey?: string;
}

function Harness({ batches, failOnce = false, resetKey }: HarnessOptions) {
  const queue = [...batches];
  let attempts = 0;

  async function loader(cursor: string | null): Promise<InfiniteScrollBatch> {
    attempts += 1;
    if (failOnce && attempts === 1) throw new Error('Network unavailable');
    const next = queue.shift() ?? [];
    return {
      rows: next.map((label) => <li key={label}>{label}</li>),
      nextCursor: queue.length > 0 ? encodeCursor({ k: 'offset', o: attempts * 10 }) : null,
    };
  }

  return (
    <InfiniteScrollProvider
      loader={loader}
      initialCursor={encodeCursor({ k: 'offset', o: 0 })}
      initialHasMore={queue.length > 0}
      resetKey={resetKey}
    >
      <ul aria-label="rows">
        <InfiniteScrollRows skeleton={<li aria-hidden="true">loading…</li>}>
          <li>first-1</li>
          <li>first-2</li>
        </InfiniteScrollRows>
      </ul>
      <InfiniteScrollStatus endLabel="No more items" loadingLabel="Loading more…" />
    </InfiniteScrollProvider>
  );
}

const rowText = () =>
  Array.from(screen.getByLabelText('rows').querySelectorAll('li'))
    .map((node) => node.textContent)
    .filter((text) => text !== 'loading…');

describe('infinite scrolling list', () => {
  it('appends the next batch when the sentinel comes into view', async () => {
    render(<Harness batches={[['second-1', 'second-2']]} />);
    expect(rowText()).toEqual(['first-1', 'first-2']);

    scrollToBottom();

    await waitFor(() => expect(rowText()).toEqual(['first-1', 'first-2', 'second-1', 'second-2']));
    // The list is complete, so the end-of-list line replaces the spinner.
    await waitFor(() => expect(screen.getByText('No more items')).toBeTruthy());
  });

  it('keeps loading until the list is exhausted, never showing a page control', async () => {
    render(<Harness batches={[['second'], ['third']]} />);

    scrollToBottom();
    await waitFor(() => expect(rowText()).toContain('second'));
    scrollToBottom();
    await waitFor(() => expect(rowText()).toContain('third'));

    expect(screen.getByText('No more items')).toBeTruthy();
    expect(screen.queryByText(/Page \d+ of/)).toBeNull();
    expect(screen.queryByRole('button', { name: /next/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /previous/i })).toBeNull();
  });

  it('never fires two requests at once', async () => {
    let inFlight = 0;
    let peak = 0;
    const batches = [['second'], ['third']];

    function SlowHarness() {
      const queue = [...batches];
      async function loader() {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 5));
        const rows = queue.shift() ?? [];
        inFlight -= 1;
        return { rows: rows.map((label) => <li key={label}>{label}</li>), nextCursor: queue.length > 0 ? 'x' : null };
      }
      return (
        <InfiniteScrollProvider loader={loader} initialCursor="x" initialHasMore>
          <ul aria-label="rows">
            <InfiniteScrollRows>
              <li>first</li>
            </InfiniteScrollRows>
          </ul>
          <InfiniteScrollStatus endLabel="No more items" />
        </InfiniteScrollProvider>
      );
    }

    render(<SlowHarness />);
    // Three "scrolled to the bottom" events while the first batch is still in
    // flight: only one request may be outstanding at any moment.
    scrollToBottom();
    scrollToBottom();
    scrollToBottom();
    await waitFor(() => expect(rowText()).toContain('second'));
    scrollToBottom();
    await waitFor(() => expect(rowText()).toContain('third'));
    expect(peak).toBe(1);
  });

  it('shows a retry button after a failure instead of looping', async () => {
    render(<Harness batches={[['second'], ['third']]} failOnce />);
    scrollToBottom();

    await waitFor(() => expect(screen.getByText('Network unavailable')).toBeTruthy());
    const retry = screen.getByRole('button', { name: /retry/i });
    // The failed batch added nothing.
    expect(rowText()).toEqual(['first-1', 'first-2']);

    fireEvent.click(retry);
    await waitFor(() => expect(rowText()).toContain('second'));
  });

  it('shows a skeleton only while a batch is in flight', async () => {
    let release: (() => void) | null = null;
    function PendingHarness() {
      async function loader() {
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        return { rows: [<li key="second">second</li>], nextCursor: null };
      }
      return (
        <InfiniteScrollProvider loader={loader} initialCursor="x" initialHasMore>
          <ul aria-label="rows">
            <InfiniteScrollRows skeleton={<li aria-hidden="true">loading…</li>}>
              <li>first</li>
            </InfiniteScrollRows>
          </ul>
          <InfiniteScrollStatus endLabel="No more items" />
        </InfiniteScrollProvider>
      );
    }

    render(<PendingHarness />);
    scrollToBottom();
    await waitFor(() => expect(screen.getByText('loading…')).toBeTruthy());

    await act(async () => {
      release?.();
    });
    await waitFor(() => expect(screen.queryByText('loading…')).toBeNull());
    expect(rowText()).toEqual(['first', 'second']);
  });

  it('starts a new list when the filters change instead of appending', async () => {
    const { rerender } = render(<Harness batches={[['second']]} resetKey="filter-a" />);
    scrollToBottom();
    await waitFor(() => expect(rowText()).toContain('second'));

    // A new filter re-renders the page server-side: new first rows, new key.
    rerender(<Harness batches={[['other-filter']]} resetKey="filter-b" />);
    await waitFor(() => expect(rowText()).toEqual(['first-1', 'first-2']));
    expect(disconnectCount).toBeGreaterThan(0);
  });

  it('stops asking once a batch comes back empty', async () => {
    render(<Harness batches={[[]]} />);
    scrollToBottom();
    await waitFor(() => expect(screen.getByText('No more items')).toBeTruthy());
    expect(rowText()).toEqual(['first-1', 'first-2']);
  });

  it('never drops the rows already on screen while the next batch loads', async () => {
    let release: (() => void) | null = null;
    function PendingHarness() {
      async function loader() {
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        return { rows: [<li key="second">second</li>], nextCursor: null };
      }
      return (
        <InfiniteScrollProvider loader={loader} initialCursor="x" initialHasMore>
          <ul aria-label="rows">
            <InfiniteScrollRows skeleton={<li aria-hidden="true">loading…</li>}>
              <li>first-1</li>
              <li>first-2</li>
            </InfiniteScrollRows>
          </ul>
          <InfiniteScrollStatus endLabel="No more items" loadingLabel="Loading more…" />
        </InfiniteScrollProvider>
      );
    }

    render(<PendingHarness />);
    scrollToBottom();
    // Mid-flight: the first batch is untouched and the spinner is showing.
    await waitFor(() => expect(screen.getByText('Loading more…')).toBeTruthy());
    expect(rowText()).toEqual(['first-1', 'first-2']);

    await act(async () => {
      release?.();
    });
    await waitFor(() => expect(rowText()).toEqual(['first-1', 'first-2', 'second']));
  });

  it('shows the end-of-list line straight away when the first batch was the last', () => {
    render(
      <InfiniteScrollProvider loader={async () => ({ rows: [], nextCursor: null })} initialHasMore={false}>
        <ul aria-label="rows">
          <InfiniteScrollRows>
            <li>only-row</li>
          </InfiniteScrollRows>
        </ul>
        <InfiniteScrollStatus endLabel="No more items" />
      </InfiniteScrollProvider>
    );

    expect(screen.getByText('No more items')).toBeTruthy();
    // No spinner and no page control for a list that is already complete.
    expect(screen.queryByRole('button', { name: /load more/i })).toBeNull();
    expect(screen.queryByText(/Page \d/)).toBeNull();
  });

  it('falls back to a single "Load more" tap without IntersectionObserver', async () => {
    vi.stubGlobal('IntersectionObserver', undefined);

    function ManualHarness() {
      const queue = [['second'], ['third']];
      async function loader() {
        const rows = queue.shift() ?? [];
        return { rows: rows.map((label) => <li key={label}>{label}</li>), nextCursor: queue.length > 0 ? 'x' : null };
      }
      return (
        <InfiniteScrollProvider loader={loader} initialCursor="x" initialHasMore>
          <ul aria-label="rows">
            <InfiniteScrollRows>
              <li>first</li>
            </InfiniteScrollRows>
          </ul>
          <InfiniteScrollStatus endLabel="No more items" />
        </InfiniteScrollProvider>
      );
    }

    render(<ManualHarness />);
    const button = await waitFor(() => screen.getByRole('button', { name: /load more/i }));
    fireEvent.click(button);
    await waitFor(() => expect(rowText()).toContain('second'));
  });
});
