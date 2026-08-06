'use client';

import { useState, useTransition } from 'react';
import { Loader2 } from 'lucide-react';
import { addRetailerToRouteAction } from '@/lib/admin/routes-actions';
import { Select } from '@/components/ui/select';
import { Button } from '@/components/ui/button';

interface RetailerOption {
  id: string;
  shop_name: string;
}

const DAY_OPTIONS = [
  { value: '', label: 'Any day' },
  { value: '2', label: 'Monday' },
  { value: '3', label: 'Tuesday' },
  { value: '4', label: 'Wednesday' },
  { value: '5', label: 'Thursday' },
  { value: '6', label: 'Friday' },
  { value: '7', label: 'Saturday' },
  { value: '1', label: 'Sunday' },
];

export function AddRouteStopForm({ routeId, retailers }: { routeId: string; retailers: RetailerOption[] }) {
  const [retailerId, setRetailerId] = useState(retailers[0]?.id ?? '');
  const [visitDay, setVisitDay] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleAdd() {
    setError(null);
    startTransition(async () => {
      try {
        await addRetailerToRouteAction(routeId, retailerId, visitDay ? Number(visitDay) : null);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to add retailer.');
      }
    });
  }

  return (
    <div className="space-y-2">
      {error ? <p className="text-xs text-primary-600">{error}</p> : null}
      <div className="flex flex-col gap-2 sm:flex-row">
        <Select value={retailerId} onChange={(e) => setRetailerId(e.target.value)} disabled={isPending}>
          {retailers.map((r) => (
            <option key={r.id} value={r.id}>
              {r.shop_name}
            </option>
          ))}
        </Select>
        <Select value={visitDay} onChange={(e) => setVisitDay(e.target.value)} disabled={isPending}>
          {DAY_OPTIONS.map((d) => (
            <option key={d.value} value={d.value}>
              {d.label}
            </option>
          ))}
        </Select>
        <Button size="sm" disabled={isPending || !retailerId} onClick={handleAdd}>
          {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          Add
        </Button>
      </div>
    </div>
  );
}
