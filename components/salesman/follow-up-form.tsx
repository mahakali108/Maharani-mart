'use client';

import { useState, useTransition } from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { createFollowUpAction, type FollowUpResult } from '@/lib/salesman/followup-actions';
import { indiaTodayDateKey } from '@/lib/datetime/india';

interface RetailerOption {
  id: string;
  shop_name: string;
}

/** Quick reminder creator for the salesman's own assigned retailers. */
export function FollowUpForm({ retailers }: { retailers: RetailerOption[] }) {
  const [retailerId, setRetailerId] = useState('');
  const [dueDate, setDueDate] = useState(indiaTodayDateKey());
  const [note, setNote] = useState('');
  const [result, setResult] = useState<FollowUpResult | null>(null);
  const [isPending, startTransition] = useTransition();

  function submit() {
    setResult(null);
    startTransition(async () => {
      const outcome = await createFollowUpAction({ retailerId, dueDate, note });
      setResult(outcome);
      if ('success' in outcome) setNote('');
    });
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      className="space-y-4"
    >
      {result && 'error' in result && result.error ? (
        <div className="rounded-xl border border-primary-200 bg-primary-50 px-4 py-3 text-sm text-primary-700">{result.error}</div>
      ) : null}
      {result && 'success' in result ? (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">Reminder saved.</div>
      ) : null}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div>
          <Label htmlFor="followup-retailer">Retailer</Label>
          <Select id="followup-retailer" value={retailerId} onChange={(e) => setRetailerId(e.target.value)} disabled={isPending}>
            <option value="">{retailers.length ? 'Select a retailer' : 'No assigned retailers'}</option>
            {retailers.map((r) => (
              <option key={r.id} value={r.id}>
                {r.shop_name}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="followup-date">Due date</Label>
          <Input id="followup-date" type="date" min={indiaTodayDateKey()} value={dueDate} onChange={(e) => setDueDate(e.target.value)} disabled={isPending} required />
        </div>
        <div>
          <Label htmlFor="followup-note">Reminder note</Label>
          <Input
            id="followup-note"
            type="text"
            minLength={3}
            maxLength={500}
            placeholder="Collect payment after Diwali"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            disabled={isPending}
            required
          />
        </div>
      </div>

      <Button type="submit" size="sm" disabled={isPending || !retailerId || !note}>
        {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
        Add reminder
      </Button>
    </form>
  );
}
