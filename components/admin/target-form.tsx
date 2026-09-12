'use client';

import { useState, useTransition } from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import {
  setStaffTargetAction,
  type TargetActionResult,
} from '@/lib/admin/targets-actions';
import { TARGET_METRICS, resolveMonthPeriod, type TargetMetric, type TargetPeriodType } from '@/lib/admin/targets-shared';
import { indiaTodayDateKey } from '@/lib/datetime/india';

interface MemberOption {
  id: string;
  full_name: string;
  role: string;
}

/**
 * Creates/updates one target. The default period is the current calendar
 * month (computed with the same pure helper the tests cover); the admin can
 * override the dates, and the server re-validates the span.
 */
export function TargetForm({ members }: { members: MemberOption[] }) {
  const currentMonth = resolveMonthPeriod(indiaTodayDateKey());
  const [memberId, setMemberId] = useState('');
  const [periodType, setPeriodType] = useState<TargetPeriodType>('month');
  const [periodStart, setPeriodStart] = useState(currentMonth?.start ?? '');
  const [periodEnd, setPeriodEnd] = useState(currentMonth?.end ?? '');
  const [metric, setMetric] = useState<TargetMetric>('sales_value');
  const [targetValue, setTargetValue] = useState('');
  const [result, setResult] = useState<TargetActionResult | null>(null);
  const [isPending, startTransition] = useTransition();

  function submit() {
    setResult(null);
    startTransition(async () => {
      const value = Number(targetValue);
      const outcome = await setStaffTargetAction({
        userId: memberId,
        periodType,
        periodStart,
        periodEnd,
        metric,
        targetValue: value,
      });
      setResult(outcome);
      if ('success' in outcome) setTargetValue('');
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
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">Target saved.</div>
      ) : null}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <div>
          <Label htmlFor="target-member">Team member</Label>
          <Select id="target-member" value={memberId} onChange={(e) => setMemberId(e.target.value)} disabled={isPending}>
            <option value="">{members.length ? 'Select a member' : 'No staff or salesmen yet'}</option>
            {members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.full_name} ({m.role === 'salesman' ? 'Sales exec' : m.role})
              </option>
            ))}
          </Select>
        </div>

        <div>
          <Label htmlFor="target-period-type">Period type</Label>
          <Select
            id="target-period-type"
            value={periodType}
            onChange={(e) => setPeriodType(e.target.value as TargetPeriodType)}
            disabled={isPending}
          >
            <option value="month">Month</option>
            <option value="quarter">Quarter</option>
          </Select>
        </div>

        <div>
          <Label htmlFor="target-metric">Metric</Label>
          <Select id="target-metric" value={metric} onChange={(e) => setMetric(e.target.value as TargetMetric)} disabled={isPending}>
            {TARGET_METRICS.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </Select>
        </div>

        <div>
          <Label htmlFor="target-start">Period start</Label>
          <Input id="target-start" type="date" value={periodStart} onChange={(e) => setPeriodStart(e.target.value)} disabled={isPending} required />
        </div>

        <div>
          <Label htmlFor="target-end">Period end</Label>
          <Input id="target-end" type="date" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} disabled={isPending} required />
        </div>

        <div>
          <Label htmlFor="target-value">Target value</Label>
          <Input
            id="target-value"
            type="number"
            min={0}
            step="0.01"
            value={targetValue}
            onChange={(e) => setTargetValue(e.target.value)}
            disabled={isPending}
            required
          />
          <p className="mt-1 text-xs text-ink-400">₹ for value metrics, plain counts otherwise.</p>
        </div>
      </div>

      <Button type="submit" size="sm" disabled={isPending || !memberId || !targetValue}>
        {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
        Save target
      </Button>
    </form>
  );
}
