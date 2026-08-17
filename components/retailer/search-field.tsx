'use client';

import { useEffect, useRef, useState, useTransition, type FormEvent } from 'react';
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
  window.localStorage.setItem(RECENT_KEY, JSON.stringify(next));
}

export function SearchField({
  initialQuery = '',
  variant = 'header',
  autoFocus = false,
}: {
  initialQuery?: string;
  variant?: 'header' | 'hero';
  autoFocus?: boolean;
}) {
  const router = useRouter();
  const rootRef = useRef<HTMLFormElement>(null);
  const [value, setValue] = useState(initialQuery);
  const [open, setOpen] = useState(false);
  const [recent, setRecent] = useState<string[]>([]);
  const [suggestions, setSuggestions] = useState<SearchSuggestionResult>({ products: [], brands: [], categories: [] });
  const [, startTransition] = useTransition();

  useEffect(() => {
    setRecent(readRecent());
  }, []);

  useEffect(() => {
    const query = value.trim();
    if (query.length < 2) {
      setSuggestions({ products: [], brands: [], categories: [] });
      return;
    }
    const handle = window.setTimeout(() => {
      startTransition(async () => {
        const result = await searchSuggestionsAction(query);
        setSuggestions(result);
      });
    }, 220);
    return () => window.clearTimeout(handle);
  }, [value]);

  useEffect(() => {
    function onPointer(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onPointer);
    return () => document.removeEventListener('mousedown', onPointer);
  }, []);

  function go(href: string, term?: string) {
    if (term) {
      writeRecent(term);
      setRecent(readRecent());
    }
    setOpen(false);
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
    <form ref={rootRef} onSubmit={handleSubmit} className="relative w-full">
      <Search
        className={cn(
          'pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400',
          variant === 'hero' && 'left-4'
        )}
      />
      <input
        name="q"
        type="search"
        value={value}
        autoFocus={autoFocus}
        autoComplete="off"
        placeholder="Search products, brands or SKU"
        onFocus={() => setOpen(true)}
        onChange={(event) => {
          setValue(event.target.value);
          setOpen(true);
        }}
        className={cn(
          'w-full rounded-xl border-0 bg-white text-sm text-slate-900 shadow-sm outline-none placeholder:text-slate-400',
          variant === 'header'
            ? 'h-10 pl-10 pr-20 focus:ring-2 focus:ring-amber-300 lg:h-11 lg:border lg:border-slate-200 lg:bg-slate-50 lg:pr-28 lg:focus:border-primary-300 lg:focus:bg-white lg:focus:ring-4 lg:focus:ring-primary-50'
            : 'h-12 pl-11 pr-24 focus:ring-2 focus:ring-amber-300'
        )}
      />
      {value ? (
        <button
          type="button"
          onClick={() => {
            setValue('');
            setSuggestions({ products: [], brands: [], categories: [] });
          }}
          className="absolute right-[4.25rem] top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full text-slate-400 hover:bg-slate-100 hover:text-slate-700 lg:right-[6.25rem]"
          aria-label="Clear search"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      ) : null}
      <button
        type="submit"
        className={cn(
          'absolute right-1.5 top-1.5 font-semibold text-white',
          variant === 'header'
            ? 'hidden h-8 rounded-lg bg-primary-600 px-5 text-xs hover:bg-primary-700 lg:inline-flex lg:items-center'
            : 'inline-flex h-9 items-center rounded-lg bg-slate-950 px-5 text-xs hover:bg-slate-800'
        )}
      >
        Search
      </button>
      {variant === 'header' ? (
        <button
          type="submit"
          className="absolute right-1.5 top-1.5 flex h-7 w-9 items-center justify-center rounded-lg bg-slate-900 text-white lg:hidden"
          aria-label="Search"
        >
          <Search className="h-3.5 w-3.5" />
        </button>
      ) : null}

      {showPanel ? (
        <div className="absolute inset-x-0 top-[calc(100%+0.4rem)] z-50 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_18px_40px_rgba(15,23,42,0.16)]">
          {value.trim().length < 2 && recent.length > 0 ? (
            <div className="p-3">
              <div className="mb-2 flex items-center justify-between">
                <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Recent searches</p>
                <button
                  type="button"
                  className="text-[10px] font-bold text-primary-600"
                  onClick={() => {
                    window.localStorage.removeItem(RECENT_KEY);
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
                    className="flex items-center gap-1 rounded-full bg-slate-50 px-2.5 py-1 text-[11px] font-semibold text-slate-600 hover:bg-primary-50 hover:text-primary-700"
                  >
                    <Clock3 className="h-3 w-3" /> {term}
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          {value.trim().length >= 2 && !hasSuggestions ? (
            <p className="px-4 py-5 text-center text-xs text-slate-500">No suggestions for “{value.trim()}”</p>
          ) : null}

          {suggestions.products.length > 0 ? (
            <ul className="border-t border-slate-100 py-1">
              {suggestions.products.map((product) => (
                <li key={product.id}>
                  <button
                    type="button"
                    onClick={() => go(`/retailer/catalog/${product.id}`, product.name)}
                    className="flex w-full items-start gap-2 px-4 py-2 text-left hover:bg-slate-50"
                  >
                    <Search className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" />
                    <span>
                      <span className="block text-xs font-semibold text-slate-800">{product.name}</span>
                      <span className="mt-0.5 block font-mono text-[10px] text-slate-400">
                        {product.brandName ? `${product.brandName} · ` : ''}SKU {product.skuCode}
                      </span>
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
                  className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs font-semibold text-slate-600 hover:bg-slate-50"
                >
                  <LayoutGrid className="h-3.5 w-3.5 text-primary-500" /> {category.name}
                  <span className="text-[10px] font-medium text-slate-400">Category</span>
                </button>
              ))}
              {suggestions.brands.map((brand) => (
                <button
                  key={brand.id}
                  type="button"
                  onClick={() => go(catalogHref({ brand: brand.id }), brand.name)}
                  className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs font-semibold text-slate-600 hover:bg-slate-50"
                >
                  <Tag className="h-3.5 w-3.5 text-amber-600" /> {brand.name}
                  <span className="text-[10px] font-medium text-slate-400">Brand</span>
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </form>
  );
}
