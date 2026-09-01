/**
 * Deterministic pack code for the default pack auto-seeded at product
 * creation (see lib/admin/products-actions.ts). Shared with the product
 * detail page so the edit form resolves the same default pack.
 *
 * Pack codes are their own identifier — separate from batch codes and
 * independent of the (removed, optional) product-level SKU code.
 */
export function defaultPackSkuForProduct(productId: string) {
  return `AUTO-${productId.replace(/-/g, '').slice(0, 8).toUpperCase()}`;
}

/**
 * Pack codes that may identify a product's auto-seeded default pack:
 * the deterministic AUTO- code (products created after the SKU-code
 * removal), plus the legacy product SKU (older products, whose seeded
 * default pack mirrored the product SKU).
 */
export function defaultPackSkuCandidates(
  productId: string,
  legacySkuCode: string | null | undefined
): string[] {
  const candidates = [defaultPackSkuForProduct(productId)];
  if (legacySkuCode) candidates.push(legacySkuCode);
  return candidates;
}
