'use client';

import { useEffect, useId, useRef, useState, type FormEvent, type Ref } from 'react';
import { useRouter } from 'next/navigation';
import { Clock3, LayoutGrid, Search, Tag, X } from 'lucide-react';
import { searchSuggestionsAction, type SearchSuggestionResult } from '@/lib/retailer/search-actions';
import { catalogHref } from '@/lib/retailer/catalog-params';
import { cn } from '@/lib/utils/cn';

const RECENT_KEY = 'maharani.recentSearches.v1';

function readRecent(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(RECENT_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string').slice(0, 8) : [];
  } catch {
    return [];
  }
}

function writeRecent(term: string) {
  const next = [term, ...readRecent().filter((item) => item.toLowerCase() !== term.toLowerCase())].slice(0, 8);
  try { window.localStorage.setItem(RECENT_KEY, JSON.stringify(next)); } catch { /* Storage is optional; search still works. */ }
}

const EMPTY_SUGGESTIONS: SearchSuggestionResult = { products: [], brands: [], categories: [] };

export function SearchField({
  initialQuery = '',
  variant = 'header',
  autoFocus = false,
  inputRef,
}: {
  initialQuery?: string;
  variant?: 'header' | 'hero';
  autoFocus?: boolean;
  /** Lets a parent (e.g. the header search icon) focus the input on demand. */
  inputRef?: Ref<HTMLInputElement>;
}) {
  const router = useRouter();
  const rootRef = useRef<HTMLFormElement>(null);
  const [value, setValue] = useState(initialQuery);
  const [open, setOpen] = useState(false);
  const [recent, setRecent] = useState<string[]>([]);
  // The outcome of the last finished suggestion request, tagged with the query
  // it answered. Everything the panel shows is derived from it during render.
  const [settled, setSettled] = useState<
    { query: string; suggestions: SearchSuggestionResult | null } | null
  >(null);
  const panelId = useId();

  const query = value.trim();
  const searching = open && query.length >= 2;
  const answer = searching && settled?.query === query ? settled : null;
  const suggestions = answer?.suggestions ?? EMPTY_SUGGESTIONS;
  const loading = searching && answer === null;
  const searchError = answer !== null && answer.suggestions === null;

  /** Opening the panel reads the recent searches (browser storage) at that moment. */
  function openPanel() {
    setRecent(readRecent());
    setOpen(true);
  }

  /** Closing the panel discards the last answer, so reopening searches afresh. */
  function closePanel() {
    setOpen(false);
    setSettled(null);
  }

  useEffect(() => {
    if (!searching) return;
    let cancelled = false;
    const handle = window.setTimeout(async () => {
      try {
        const result = await searchSuggestionsAction(query);
        if (!cancelled) setSettled({ query, suggestions: result });
      } catch {
        if (!cancelled) setSettled({ query, suggestions: null });
      }
    }, 220);
    return () => { cancelled = true; window.clearTimeout(handle); };
  }, [query, searching]);

  useEffect(() => {
    function onPointer(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
        setSettled(null);
      }
    }
    document.addEventListener('mousedown', onPointer);
    return () => document.removeEventListener('mousedown', onPointer);
  }, []);

  function go(href: string, term?: string) {
    if (term) {
      writeRecent(term);
      setRecent(readRecent());
    }
    closePanel();
    router.push(href);
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const term = value.trim();
    go(catalogHref({ q: term || undefined }), term || undefined);
  }

  const hasSuggestions =
    suggestions.products.length + suggestions.brands.length + suggestions.categories.length > 0;
  const showPanel = open && (recent.length > 0 || hasSuggestions || value.trim().length >= 2);

  return (
    <form ref={rootRef} onSubmit={handleSubmit} role="search"
      aria-label={variant === 'hero' ? 'Search wholesale products' : 'Search catalog'}
      onKeyDown={(event) => { if (event.key === 'Escape') closePanel(); }}
      onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node)) closePanel(); }}
      className="relative w-full min-w-0">
      <Search
        aria-hidden="true"
        className={cn(
          'pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500',
          variant === 'hero' && 'left-4'
        )}
      />
      <input
        ref={inputRef}
        aria-label="Search products, brands and categories"
        aria-controls={showPanel ? panelId : undefined}
        name="q"
        maxLength={120}
        type="search"
        value={value}
        autoFocus={autoFocus}
        autoComplete="off"
        placeholder={variant === 'hero' ? 'Search products' : 'Search products, brands, categories'}
        onFocus={openPanel}
        onChange={(event) => {
          setValue(event.target.value);
          setSettled(null);
          openPanel();
        }}
        className={cn(
          'min-w-0 w-full rounded-xl bg-white text-sm text-slate-900 shadow-sm outline-none placeholder:text-slate-500',
          variant === 'header'
            ? 'h-11 border border-slate-400 bg-slate-50 pl-10 pr-28 focus:border-action-600 focus:bg-white focus:ring-2 focus:ring-action-100 lg:pr-40'
            : cn('h-12 border border-action-500 bg-action-50/40 pl-10 focus:border-action-600 focus:bg-white focus:ring-2 focus:ring-action-100 sm:h-14 sm:pl-11', value ? 'pr-32 sm:pr-36' : 'pr-24')
        )}
      />
      {value ? (
        <button
          type="button"
          onClick={() => {
            setValue('');
            setSettled(null);
          }}
          className={cn('absolute top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full text-slate-500 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action-500', variant === 'hero' ? 'right-20 sm:right-24' : 'right-14 lg:right-28')}
          aria-label="Clear search"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      ) : null}
      <button
        type="submit"
        className={cn(
          'absolute right-1.5 top-1/2 -translate-y-1/2 rounded-lg font-semibold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action-500 focus-visible:ring-offset-2',
          variant === 'header'
            ? 'hidden h-11 bg-action-600 px-5 text-xs hover:bg-action-700 lg:inline-flex lg:items-center'
            : 'inline-flex h-11 items-center bg-action-600 px-3 text-xs hover:bg-action-700 sm:right-2 sm:px-5'
        )}
      >
        Search
      </button>
      {variant === 'header' ? (
        <button
          type="submit"
          className="absolute right-1.5 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-lg bg-action-600 text-white transition hover:bg-action-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action-500 lg:hidden"
          aria-label="Search"
        >
          <Search className="h-3.5 w-3.5" />
        </button>
      ) : null}

      {showPanel ? (
        <div id={panelId} role="region" aria-label="Search suggestions" className="absolute inset-x-0 top-[calc(100%+0.4rem)] z-50 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_18px_40px_rgba(15,23,42,0.16)]">
          {value.trim().length < 2 && recent.length > 0 ? (
            <div className="p-3">
              <div className="mb-2 flex items-center justify-between">
                <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Recent searches</p>
                <button
                  type="button"
                  className="inline-flex min-h-11 items-center rounded-lg px-2 text-[10px] font-bold text-primary-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-action-500"
                  onClick={() => {
                    try { window.localStorage.removeItem(RECENT_KEY); } catch { /* Optional storage. */ }
                    setRecent([]);
                  }}
                >
                  Clear
                </button>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {recent.map((term) => (
                  <button
                    key={term}
                    type="button"
                    onClick={() => go(catalogHref({ q: term }), term)}
                    className="flex min-h-11 items-center gap-1 rounded-full bg-slate-50 px-2.5 py-2 text-[11px] font-semibold text-slate-600 hover:bg-primary-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-action-500 hover:text-primary-700"
                  >
                    <Clock3 className="h-3 w-3" /> {term}
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          {loading ? <p role="status" className="px-4 py-5 text-xs text-slate-500">Searching…</p> : null}
          {searchError ? <p role="status" className="px-4 py-5 text-xs text-slate-600">Suggestions are unavailable. Press Search to search the catalog.</p> : null}
          {query.length >= 2 && !loading && !searchError && !hasSuggestions ? (
            <p role="status" className="break-words px-4 py-5 text-center text-xs text-slate-500">No suggestions for “{value.trim()}”</p>
          ) : null}

          {suggestions.products.length > 0 ? (
            <ul className="border-t border-slate-100 py-1">
              {suggestions.products.map((product) => (
                <li key={product.id}>
                  <button
                    type="button"
                    onClick={() => go(`/retailer/catalog/${product.id}`, product.name)}
                    className="flex min-h-11 w-full items-start gap-2 px-4 py-2 text-left hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-action-500"
                  >
                    <Search className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-500" />
                    <span className="min-w-0">
                      <span className="block truncate text-xs font-semibold text-slate-800">{product.name}</span>
                      {product.brandName || product.variantHint ? (
                        <span className="mt-0.5 block truncate text-[10px] text-slate-500">
                          {[product.brandName, product.variantHint ? `Size ${product.variantHint}` : null]
                            .filter(Boolean)
                            .join(' · ')}
                        </span>
                      ) : null}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}

          {suggestions.brands.length > 0 || suggestions.categories.length > 0 ? (
            <div className="space-y-1 border-t border-slate-100 p-3">
              {suggestions.categories.map((category) => (
                <button
                  key={category.id}
                  type="button"
                  onClick={() => go(catalogHref({ category: category.id }), category.name)}
                  className="flex min-h-11 w-full items-center gap-2 rounded-lg px-2 py-2.5 text-left text-xs font-semibold text-slate-600 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-action-500"
                >
                  <LayoutGrid className="h-3.5 w-3.5 text-primary-500" /> {category.name}
                  <span className="text-[10px] font-medium text-slate-500">Category</span>
                </button>
              ))}
              {suggestions.brands.map((brand) => (
                <button
                  key={brand.id}
                  type="button"
                  onClick={() => go(catalogHref({ brand: brand.id }), brand.name)}
                  className="flex min-h-11 w-full items-center gap-2 rounded-lg px-2 py-2.5 text-left text-xs font-semibold text-slate-600 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-action-500"
                >
                  <Tag className="h-3.5 w-3.5 text-amber-600" /> {brand.name}
                  <span className="text-[10px] font-medium text-slate-500">Brand</span>
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </form>
  );
}
