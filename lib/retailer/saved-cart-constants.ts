/** Reserved owner cart for PWA and native save-for-later flows. */
export const SAVE_FOR_LATER_CART_NAME = 'Saved for later';
export const MAX_SAVED_CARTS = 20;
export const MAX_LINES_PER_SAVED_CART = 100;

/** Normalize harmless case/whitespace variants so the reserved list stays unique. */
export function isSaveForLaterCartName(name: string): boolean {
  return name.replace(/\s+/g, ' ').trim().toLocaleLowerCase('en-US') ===
    SAVE_FOR_LATER_CART_NAME.toLocaleLowerCase('en-US');
}
