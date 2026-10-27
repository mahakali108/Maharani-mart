/**
 * Retailer category (tier) pricing — pure, isomorphic helpers.
 *
 * A retailer is classified as `general` (highest standard wholesale price),
 * `silver` (medium) or `gold` (lowest approved wholesale price). The category
 * is assigned by an administrator after review (migration 0081) and is NOT a
 * paid subscription.
 *
 * Ordering is a hard invariant everywhere: gold <= silver <= general. The
 * database enforces it with a trigger (migration 0082) and re-prices every
 * checkout line from `product_tier_prices`; this module is the single
 * TypeScript implementation of the same rules so catalogue, cart and checkout
 * previews cannot drift from what the server will charge.
 *
 * No Supabase client, no `next/*` — safe to import anywhere.
 */

export type RetailerCategory = 'general' | 'silver' | 'gold';

export const RETAILER_CATEGORIES: readonly RetailerCategory[] = ['general', 'silver', 'gold'];

export const RETAILER_CATEGORY_LABELS: Record<RetailerCategory, { en: string; hi: string; description: string }> = {
  general: {
    en: 'General Retailer',
    hi: 'जनरल रिटेलर',
    description: 'Standard wholesale price.',
  },
  silver: {
    en: 'Silver Retailer',
    hi: 'सिल्वर रिटेलर',
    description: 'Medium approved wholesale price.',
  },
  gold: {
    en: 'Gold Retailer',
    hi: 'गोल्ड रिटेलर',
    description: 'Lowest approved wholesale price.',
  },
};

/** True when the value is one of the three known categories. */
export function isRetailerCategory(value: unknown): value is RetailerCategory {
  return typeof value === 'string' && (RETAILER_CATEGORIES as readonly string[]).includes(value);
}

/** Normalise an unknown database value. Unknown/absent values are `general`. */
export function normalizeRetailerCategory(value: unknown): RetailerCategory {
  return isRetailerCategory(value) ? value : 'general';
}

export interface CategoryPriceSet {
  general?: number | null;
  silver?: number | null;
  gold?: number | null;
}

export interface CategoryOrderingResult {
  ok: boolean;
  /** Human-readable reason when not ok; null when ok. */
  message: string | null;
}

/**
 * gold <= silver <= general, compared in integer paise so floating point
 * artefacts cannot make 99.999 < 100 "fail".
 */
export function validateCategoryPriceOrdering(prices: CategoryPriceSet): CategoryOrderingResult {
  const toPaise = (value: number | null | undefined): number | null => {
    if (value === null || value === undefined) return null;
    if (!Number.isFinite(value) || value <= 0) return null;
    return Math.round(value * 100);
  };

  const general = toPaise(prices.general);
  const silver = toPaise(prices.silver);
  const gold = toPaise(prices.gold);

  if (gold !== null && silver !== null && gold > silver) {
    return { ok: false, message: 'The gold price cannot be higher than the silver price.' };
  }
  if (gold !== null && general !== null && gold > general) {
    return { ok: false, message: 'The gold price cannot be higher than the general price.' };
  }
  if (silver !== null && general !== null && silver > general) {
    return { ok: false, message: 'The silver price cannot be higher than the general price.' };
  }
  return { ok: true, message: null };
}

/**
 * The price a retailer may be charged for one pack, from the rows the caller
 * can legally see.
 *
 *   - the retailer's own category wins when configured;
 *   - otherwise the general (standard) price applies;
 *   - otherwise null: the pack has no category pricing and the pre-existing
 *     slab / case-price rules continue to govern it.
 *
 * This NEVER looks "up" from general to silver/gold, so a general retailer can
 * never be shown, or charged, a Silver/Gold price.
 */
export function resolveCategoryPiecePrice(
  category: RetailerCategory,
  rows: CategoryPriceSet
): number | null {
  const own = rows[category];
  if (typeof own === 'number' && Number.isFinite(own) && own > 0) return own;
  if (category !== 'general') {
    const general = rows.general;
    if (typeof general === 'number' && Number.isFinite(general) && general > 0) return general;
  }
  return null;
}

/** Human label for a category (English UI default; Hindi where helpful). */
export function categoryLabel(category: RetailerCategory, locale: 'en' | 'hi' = 'en'): string {
  return RETAILER_CATEGORY_LABELS[category][locale];
}
