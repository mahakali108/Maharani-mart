'use client';

import { useState, useTransition } from 'react';
import { ChevronUp, ChevronDown, LogIn, LogOut, SkipForward, Loader2, CheckCircle2 } from 'lucide-react';
import { reorderRouteStopAction } from '@/lib/salesman/routes-actions';
import { checkInVisitAction, checkOutVisitAction, skipVisitAction } from '@/lib/salesman/visits-actions';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

interface Visit {
  id: string;
  status: string;
  check_in_at: string | null;
}

function getLocation(): Promise<{ lat: number | null; lng: number | null }> {
  return new Promise((resolve) => {
    if (!navigator.geolocation) {
      resolve({ lat: null, lng: null });
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => resolve({ lat: null, lng: null }),
      { timeout: 5000 }
    );
  });
}

export function RouteStopCard({
  routeId,
  stopId,
  retailerId,
  shopName,
  address,
  visit,
  isFirst,
  isLast,
}: {
  routeId: string;
  stopId: string;
  retailerId: string;
  shopName: string;
  address: string | null;
  visit: Visit | null;
  isFirst: boolean;
  isLast: boolean;
}) {
  const [isPending, startTransition] = useTransition();
  const [notes, setNotes] = useState('');
  const [showNotes, setShowNotes] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const status = visit?.status ?? 'planned';

  function handleCheckIn() {
    setError(null);
    startTransition(async () => {
      const { lat, lng } = await getLocation();
      const result = await checkInVisitAction(retailerId, lat, lng);
      if ('error' in result && result.error) setError(result.error);
    });
  }

  function handleCheckOut() {
    if (!visit) return;
    setError(null);
    startTransition(async () => {
      const result = await checkOutVisitAction(visit.id, notes);
      if ('error' in result && result.error) setError(result.error);
      else setShowNotes(false);
    });
  }

  function handleSkip() {
    setError(null);
    startTransition(async () => {
      const result = await skipVisitAction(retailerId, notes);
      if ('error' in result && result.error) setError(result.error);
    });
  }

  return (
    <Card className="space-y-2 p-3.5">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm font-medium text-ink-900">{shopName}</p>
          {address ? <p className="text-xs text-ink-400">{address}</p> : null}
        </div>
        <div className="flex flex-col gap-1">
          <button
            type="button"
            disabled={isPending || isFirst}
            onClick={() =>
  startTransition(async () => {
    await reorderRouteStopAction(routeId, stopId, 'up');
  })
            }
            className="rounded-lg p-1 text-ink-400 hover:bg-ink-100 disabled:opacity-30"
          >
            <ChevronUp className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            disabled={isPending || isLast}
            onClick={() =>
  startTransition(async () => {
    await reorderRouteStopAction(routeId, stopId, 'down');
  })
            }
            className="rounded-lg p-1 text-ink-400 hover:bg-ink-100 disabled:opacity-30"
          >
            <ChevronDown className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {error ? <p className="text-xs text-primary-600">{error}</p> : null}

      {status === 'planned' ? (
        <div className="flex gap-2">
          <Button size="sm" onClick={handleCheckIn} disabled={isPending} className="flex-1">
            {isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <LogIn className="h-3.5 w-3.5" />}
            Check in
          </Button>
          <Button size="sm" variant="outline" onClick={handleSkip} disabled={isPending}>
            <SkipForward className="h-3.5 w-3.5" />
            Skip
          </Button>
        </div>
      ) : status === 'checked_in' ? (
        <div className="space-y-2">
          {showNotes ? (
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Visit notes (optional)"
              rows={2}
              className="w-full rounded-xl border border-ink-200 bg-white px-3 py-2 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-primary-600"
            />
          ) : null}
          <Button
            size="sm"
            variant="outline"
            onClick={() => (showNotes ? handleCheckOut() : setShowNotes(true))}
            disabled={isPending}
            className="w-full"
          >
            {isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <LogOut className="h-3.5 w-3.5" />}
            {showNotes ? 'Confirm check out' : 'Check out'}
          </Button>
        </div>
      ) : (
        <p className="flex items-center gap-1.5 text-xs text-green-700">
          <CheckCircle2 className="h-3.5 w-3.5" />
          {status === 'skipped' ? 'Skipped' : 'Visit complete'}
        </p>
      )}
    </Card>
  );
    }
          
