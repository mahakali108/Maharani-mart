'use client';

import { useState, useTransition } from 'react';
import { Loader2, CheckCircle2 } from 'lucide-react';
import { placeOrderAction } from '@/lib/retailer/checkout-actions';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';

export function CheckoutForm() {
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handlePlaceOrder() {
    setError(null);
    startTransition(async () => {
      const result = await placeOrderAction(notes);
      // On success, placeOrderAction redirects server-side and never
      // returns to this branch. We only reach here on failure.
      if (result && 'error' in result) {
        setError(result.error ?? 'Failed to place order.');
      }
    });
  }

  return (
    <Card className="space-y-4">
      <CardHeader>
        <CardTitle>Delivery notes</CardTitle>
      </CardHeader>
      <div>
        <Label htmlFor="notes">Notes for this order (optional)</Label>
        <textarea
          id="notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={3}
          placeholder="e.g. preferred delivery time, landmark, special instructions"
          className="w-full rounded-xl border border-ink-200 bg-white px-3.5 py-2.5 text-sm text-ink-900 placeholder:text-ink-400 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-primary-600"
        />
      </div>

      {error ? (
        <div className="rounded-xl border border-primary-200 bg-primary-50 px-4 py-3 text-sm text-primary-700">{error}</div>
      ) : null}

      <Button onClick={handlePlaceOrder} disabled={isPending} className="w-full">
        {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
        {isPending ? 'Placing order…' : 'Place order'}
      </Button>
    </Card>
  );
}
