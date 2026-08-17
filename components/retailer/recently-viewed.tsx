'use client';

import { useEffect, useState } from 'react';
import { loadPricedProductsAction } from '@/lib/retailer/search-actions';
import { ProductRail } from '@/components/retailer/product-rail';
import type { ProductCardProps } from '@/components/retailer/product-card';

export const RECENTLY_VIEWED_KEY = 'maharani.recentlyViewed.v1';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function rememberViewedProduct(productId: string) {
  if (typeof window === 'undefined' || !UUID_RE.test(productId)) return;
  try {
    const raw = window.localStorage.getItem(RECENTLY_VIEWED_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    const existing = Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
    const next = [productId, ...existing.filter((id) => id !== productId)].slice(0, 16);
    window.localStorage.setItem(RECENTLY_VIEWED_KEY, JSON.stringify(next));
  } catch {
    // Ignore private-mode storage failures.
  }
}

export function RecentlyViewedTracker({ productId }: { productId: string }) {
  useEffect(() => {
    rememberViewedProduct(productId);
  }, [productId]);
  return null;
}

export function RecentlyViewedRail({ excludeId }: { excludeId?: string }) {
  const [products, setProducts] = useState<ProductCardProps[]>([]);

  useEffect(() => {
    let cancelled = false;
    try {
      const raw = window.localStorage.getItem(RECENTLY_VIEWED_KEY);
      const parsed = raw ? (JSON.parse(raw) as unknown) : [];
      const ids = (Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [])
        .filter((id) => id !== excludeId)
        .slice(0, 12);
      if (ids.length === 0) return;
      void loadPricedProductsAction(ids).then((cards) => {
        if (!cancelled) setProducts(cards);
      });
    } catch {
      // Ignore.
    }
    return () => {
      cancelled = true;
    };
  }, [excludeId]);

  if (products.length === 0) return null;
  return <ProductRail eyebrow="Continue browsing" title="Recently viewed" products={products} href="/retailer/catalog" />;
}
