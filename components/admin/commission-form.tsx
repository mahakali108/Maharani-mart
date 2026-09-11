'use client';

import { useState, useTransition } from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { generateCommissionAction, type CommissionActionResult } from '@/lib/admin/commissions-actions';
import { COMMISSION_BASES, type CommissionBasis } from '@/lib/admin/targets-shared';
import { resolveMonthPeriod } from '@/lib/admin/targets-shared';
import { indiaTodayDateKey } from '@/lib/datetime/india';

interface MemberOption {
  id: string;
  full_name: string;
  role: string;
}

/**
 * Generates a draft commission from REAL orders in the period — the basis
 * amount is computed server-side, never trusted from this form.
 */
export function CommissionForm({ members }: { members: MemberOption[] }) {
  const currentMonth = resolveMonthPeriod(indiaTodayDateKey());
  const [memberId, setMemberId] = useState('');
  const [basis, setBasis] = useState<CommissionBasis>('sales_value');
  const [periodStart, setPeriodStart] = useState(currentMonth?.start ?? '');
  const [periodEnd, setPeriodEnd] = useState(currentMonth?.end ?? '');
  const [ratePercent, setRatePercent] = useState('');
  const [notes, setNotes] = useState('');
  const [result, setResult] = useState<CommissionActionResult | null>(null);
  const [isPending, startTransition] = useTransition();

  function submit() {
    setResult(null);
    startTransition(async () => {
      const outcome = await generateCommissionAction({
        userId: memberId,
        periodStart,
        periodEnd,
        basis,
        ratePercent: Number(ratePercent),
        notes,
      });
      setResult(outcome);
      if ('success' in outcome) {
        setRatePercent('');
        setNotes('');
      }
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
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
          Commission generated from real orders in the period.
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <div>
          <Label htmlFor="commission-member">Team member</Label>
          <Select id="commission-member" value={memberId} onChange={(e) => setMemberId(e.target.value)} disabled={isPending}>
            <option value="">{members.length ? 'Select a member' : 'No staff or salesmen yet'}</option>
            {members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.full_name} ({m.role === 'salesman' ? 'Sales exec' : m.role})
              </option>
            ))}
          </Select>
        </div>

        <div>
          <Label htmlFor="commission-basis">Basis</Label>
          <Select id="commission-basis" value={basis} onChange={(e) => setBasis(e.target.value as CommissionBasis)} disabled={isPending}>
            {COMMISSION_BASES.map((b) => (
              <option key={b.value} value={b.value}>
                {b.label}
              </option>
            ))}
          </Select>
          <p className="mt-1 text-xs text-ink-400">Collection basis unlocks with the payments module (Phase 4).</p>
        </div>

        <div>
          <Label htmlFor="commission-rate">Rate (%)</Label>
          <Input
            id="commission-rate"
            type="number"
            min={0}
            max={100}
            step="0.01"
            value={ratePercent}
            onChange={(e) => setRatePercent(e.target.value)}
            disabled={isPending}
            required
          />
        </div>

        <div>
          <Label htmlFor="commission-start">Period start</Label>
          <Input id="commission-start" type="date" value={periodStart} onChange={(e) => setPeriodStart(e.target.value)} disabled={isPending} required />
        </div>

        <div>
          <Label htmlFor="commission-end">Period end</Label>
          <Input id="commission-end" type="date" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} disabled={isPending} required />
        </div>

        <div>
          <Label htmlFor="commission-notes">Notes (optional)</Label>
          <Input id="commission-notes" type="text" maxLength={500} value={notes} onChange={(e) => setNotes(e.target.value)} disabled={isPending} />
        </div>
      </div>

      <Button type="submit" size="sm" disabled={isPending || !memberId || !ratePercent}>
        {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
        Generate commission
      </Button>
    </form>
  );
}
