/**
 * Universal product name helper — works for EVERY category.
 *
 * Root cause of "Garnier Men AcnoFight Anti-Pimple Face Wash 50g" showing as
 * "ACNI FACE WASH 50G":
 *   The display was using only product_packs.pack_name or a truncated product
 *   name, losing brand and canonical product title, and duplicating size when
 *   it was already present.
 *
 * This module is the SINGLE source of truth for how a product's display name
 * is built from real Supabase fields:
 *   - brands.name (brand)
 *   - products.name (canonical product name)
 *   - product_packs.pack_name (variant/size name, e.g. "50g", "100g", "Case of 12")
 *
 * Rules:
 * - Use real canonical product name from Supabase (products.name).
 * - Category name must never replace actual product name.
 * - Preserve real brand name, product name, variant name, and size.
 * - Do not hardcode any category.
 * - Do not alter database values.
 * - If size is already included in product name, do not append twice.
 * - If size is stored separately, append selected size exactly once.
 * - Use selected variant's real name and size.
 * - If real data missing, show safe fallback instead of inventing name.
 *
 * Example:
 *   Brand: Garnier Men
 *   Product: AcnoFight Anti-Pimple Face Wash
 *   Variant: 50g
 *   => Garnier Men AcnoFight Anti-Pimple Face Wash 50g
 *
 *   Brand: null, Product: AcnoFight Anti-Pimple Face Wash 50g, Variant: 50g
 *   => AcnoFight Anti-Pimple Face Wash 50g (size not duplicated)
 */

function normalize(str: string): string {
  return str.trim().replace(/\s+/g, ' ');
}

function normalizeForCompare(str: string): string {
  return normalize(str).toLowerCase();
}

/**
 * Checks if `container` already contains `candidate` as a distinct token or
 * substring, case-insensitive. Avoids false positives like "50g" inside
 * "150g"? We treat exact case-insensitive substring match, but with word
 * boundary awareness for short sizes.
 *
 * For size duplication detection, we check if productName already ends with
 * packName or contains it.
 */
function containsSize(productName: string, size: string): boolean {
  const prod = normalizeForCompare(productName);
  const sz = normalizeForCompare(size);
  if (!sz) return false;
  if (prod === sz) return true;
  // If product name already contains size as substring
  if (prod.includes(sz)) return true;
  // Also check without spaces: "50g" vs "50 g"
  const prodNoSpace = prod.replace(/\s+/g, '');
  const szNoSpace = sz.replace(/\s+/g, '');
  if (prodNoSpace.includes(szNoSpace)) return true;
  return false;
}

function containsBrand(productName: string, brandName: string): boolean {
  const prod = normalizeForCompare(productName);
  const brand = normalizeForCompare(brandName);
  if (!brand) return false;
  return prod.includes(brand);
}

export interface CanonicalNameInput {
  brandName?: string | null;
  productName?: string | null;
  packName?: string | null;
  /** Optional fallback when productName missing */
  fallbackName?: string | null;
}

/**
 * Builds the full canonical display name: Brand + Product + Variant (size)
 * without duplication.
 *
 * Safe fallback: if productName missing, uses packName, then brandName, then
 * "Product".
 */
export function buildCanonicalProductName(input: CanonicalNameInput): string {
  const brand = input.brandName ? normalize(input.brandName) : '';
  const product = input.productName ? normalize(input.productName) : '';
  const pack = input.packName ? normalize(input.packName) : '';
  const fallback = input.fallbackName ? normalize(input.fallbackName) : '';

  // Determine base product name
  let base = product;
  if (!base) {
    // If product missing, try pack, then brand, then fallback, then generic
    if (pack) base = pack;
    else if (brand) base = brand;
    else if (fallback) base = fallback;
    else base = 'Product';
  }

  // If base is exactly the pack and we have brand, prefer brand + pack?
  // But we still want to avoid inventing. If product missing and we have both
  // brand and pack, combine them.
  if (!product && brand && pack && base === pack) {
    // Brand + pack is better than just pack
    if (!containsBrand(pack, brand)) {
      return `${brand} ${pack}`.trim();
    }
    return pack;
  }

  // If product already contains brand, don't prepend brand again
  let withBrand = base;
  if (brand && !containsBrand(base, brand)) {
    withBrand = `${brand} ${base}`.trim();
  }

  // If pack exists and not already in product name, append it exactly once
  if (pack) {
    // If base already is pack, don't duplicate
    if (normalizeForCompare(base) === normalizeForCompare(pack)) {
      return withBrand;
    }
    // If product name already contains size, don't append
    if (containsSize(product || base, pack)) {
      return withBrand;
    }
    // Otherwise append pack
    return `${withBrand} ${pack}`.trim();
  }

  return withBrand;
}

/**
 * Builds a short display name for cards, where brand is shown separately.
 * So we don't need to include brand in the name itself if brand is rendered
 * as a separate pill, but we still want canonical product name + size.
 *
 * For product cards, we want: ProductName + PackName (if not duplicated)
 * Brand is displayed separately.
 */
export function buildProductCardName(input: { productName?: string | null; packName?: string | null; fallbackName?: string | null }): string {
  const product = input.productName ? normalize(input.productName) : '';
  const pack = input.packName ? normalize(input.packName) : '';
  const fallback = input.fallbackName ? normalize(input.fallbackName) : '';

  let base = product;
  if (!base) {
    if (pack) base = pack;
    else if (fallback) base = fallback;
    else base = 'Product';
  }

  if (pack && normalizeForCompare(base) !== normalizeForCompare(pack) && !containsSize(product || base, pack)) {
    return `${base} ${pack}`.trim();
  }
  return base;
}

/**
 * For breadcrumb: show the real product name, truncated, not category.
 * If product name missing, safe fallback.
 */
export function buildBreadcrumbProductName(productName?: string | null): string {
  const name = productName ? normalize(productName) : '';
  if (!name) return 'Product';
  return name;
}

/**
 * For cart, checkout, order detail, invoice: show full canonical name
 * including brand, product, and pack.
 */
export function buildOrderLineName(input: CanonicalNameInput): string {
  return buildCanonicalProductName(input);
}

/**
 * Safe fallback when data missing — never invents a name.
 */
export function safeProductName(name?: string | null): string {
  const n = name ? normalize(name) : '';
  return n || 'Product';
}
