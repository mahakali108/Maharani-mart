import { Card, CardHeader, CardTitle } from '@/components/ui/card';

/**
 * Presentational credit summary (Requirement E). Pure display: all
 * values are read from the retailers table (credit_limit /
 * outstanding_balance) by caller server components, and enforcement
 * stays exactly where it already was — the server-side credit check
 * inside createOrderForRetailer. The "after order" figure shown at
 * checkout mirrors that check's arithmetic (credit_limit > 0 means a
 * limit is configured; 0 means "not set").
 */
export function CreditSummary({
  creditLimit,
  outstandingBalance,
  orderImpact,
}: {
  creditLimit: number;
  outstandingBalance: number;
  /** Current cart/order total to show as "this order" impact (checkout). */
  orderImpact?: number;
}) {
  const hasLimit = creditLimit > 0;
  const availableCredit = hasLimit ? Math.max(0, creditLimit - outstandingBalance) : null;
  const availableAfter =
    orderImpact !== undefined && availableCredit !== null
      ? Math.max(0, availableCredit - orderImpact)
      : null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Credit</CardTitle>
      </CardHeader>
      <div className="grid grid-cols-3 gap-2 text-center">
        <div>
          <p className="text-[11px] uppercase tracking-wide text-ink-400">Limit</p>
          <p className="mt-1 text-sm font-semibold text-ink-900">
            {hasLimit ? `₹${creditLimit.toFixed(2)}` : 'Not set'}
          </p>
        </div>
        <div>
          <p className="text-[11px] uppercase tracking-wide text-ink-400">Outstanding</p>
          <p className={`mt-1 text-sm font-semibold ${outstandingBalance > 0 ? 'text-primary-600' : 'text-ink-900'}`}>
            ₹{outstandingBalance.toFixed(2)}
          </p>
        </div>
        <div>
          <p className="text-[11px] uppercase tracking-wide text-ink-400">Available</p>
          <p className="mt-1 text-sm font-semibold text-green-700">
            {availableCredit === null ? '—' : `₹${availableCredit.toFixed(2)}`}
          </p>
        </div>
      </div>

      {orderImpact !== undefined && availableCredit !== null ? (
        <div className="mt-3 space-y-1.5 border-t border-ink-100 pt-3 text-sm">
          <div className="flex justify-between text-ink-600">
            <span>This order</span>
            <span>₹{orderImpact.toFixed(2)}</span>
          </div>
          <div className={`flex justify-between font-medium ${availableAfter! > 0 || orderImpact === 0 ? 'text-ink-900' : 'text-primary-600'}`}>
            <span>Available after this order</span>
            <span>₹{availableAfter!.toFixed(2)}</span>
          </div>
          <p className="text-xs text-ink-400">
            Your credit is rechecked when the order is placed.
          </p>
        </div>
      ) : null}
    </Card>
  );
}
