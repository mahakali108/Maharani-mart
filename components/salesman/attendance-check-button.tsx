'use client';

import { useState, useTransition } from 'react';
import { Loader2, LogIn, LogOut, CheckCircle2 } from 'lucide-react';
import { checkInAction, checkOutAction } from '@/lib/salesman/attendance-actions';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

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

export function AttendanceCheckButton({
  checkedIn,
  checkedOut,
  punchInAt,
  punchOutAt,
}: {
  checkedIn: boolean;
  checkedOut: boolean;
  punchInAt: string | null;
  punchOutAt: string | null;
}) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleCheckIn() {
    setError(null);
    startTransition(async () => {
      const { lat, lng } = await getLocation();
      const result = await checkInAction(lat, lng);
      if ('error' in result && result.error) setError(result.error);
    });
  }

  function handleCheckOut() {
    setError(null);
    startTransition(async () => {
      const { lat, lng } = await getLocation();
      const result = await checkOutAction(lat, lng);
      if ('error' in result && result.error) setError(result.error);
    });
  }

  return (
    <Card className="space-y-3">
      {error ? (
        <div className="rounded-xl border border-primary-200 bg-primary-50 px-4 py-3 text-sm text-primary-700">{error}</div>
      ) : null}

      {!checkedIn ? (
        <Button onClick={handleCheckIn} disabled={isPending} className="w-full">
          {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogIn className="h-4 w-4" />}
          Check in for today
        </Button>
      ) : !checkedOut ? (
        <>
          <p className="flex items-center gap-2 text-sm text-green-700">
            <CheckCircle2 className="h-4 w-4" />
            Checked in at {punchInAt ? new Date(punchInAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : ''}
          </p>
          <Button onClick={handleCheckOut} disabled={isPending} variant="outline" className="w-full">
            {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogOut className="h-4 w-4" />}
            Check out
          </Button>
        </>
      ) : (
        <p className="flex items-center gap-2 text-sm text-ink-600">
          <CheckCircle2 className="h-4 w-4 text-green-600" />
          Day complete — checked in{' '}
          {punchInAt ? new Date(punchInAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : ''}, checked out{' '}
          {punchOutAt ? new Date(punchOutAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : ''}
        </p>
      )}
    </Card>
  );
      }
