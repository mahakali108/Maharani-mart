/** Display helpers only. Never used as a source of prices or tax. */

export function formatInr(value: number): string {
  return `₹${value.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function calcDiscountPercent(mrp: number | null | undefined, price: number | null | undefined): number {
  if (mrp == null || price == null || mrp <= price) return 0;
  return Math.round(((mrp - price) / mrp) * 100);
}

export function calcSavings(mrp: number | null | undefined, price: number | null | undefined, quantity = 1): number {
  if (mrp == null || price == null || mrp <= price || quantity < 1) return 0;
  return (mrp - price) * quantity;
}

export function greetingForHour(hour: number): string {
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}
