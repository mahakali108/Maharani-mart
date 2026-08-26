'use client';

import { useState, useTransition } from 'react';
import { BellRing, CheckCircle2, Loader2, XCircle } from 'lucide-react';
import { runCommandCenterSmartAlerts } from '@/lib/admin/command-center/actions';
import { Button } from '@/components/ui/button';

export function RunAlertsButton() {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<null | { ok: boolean; sent: number; deduped: number; messages: string[]; error?: string }>(null);

  function trigger() {
    startTransition(async () => {
      const res = await runCommandCenterSmartAlerts();
      setResult({ ok: res.ok, sent: res.sent, deduped: res.deduped, messages: res.signals, error: res.error });
    });
  }

  return (
    <div className="flex flex-col items-end gap-2">
      <Button onClick={trigger} disabled={pending} size="sm" variant="secondary">
        {pending ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <BellRing className="mr-1.5 h-3.5 w-3.5" />}
        {pending ? 'Evaluating signals…' : 'Run smart alerts'}
      </Button>
      {result ? (
        <div
          className={
            result.ok
              ? 'max-w-md rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-right text-xs text-emerald-800'
              : 'max-w-md rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-right text-xs text-red-700'
          }
          role="status"
          aria-live="polite"
        >
          {result.ok ? (
            <p>
              <CheckCircle2 className="mr-1 inline h-3.5 w-3.5" />
              {result.sent > 0 ? `Sent ${result.sent} new alert(s) to Super Admins.` : 'No new alerts.'}{' '}
              {result.deduped > 0 ? `${result.deduped} already sent in the last 24h (deduplicated).` : null}
            </p>
          ) : (
            <p>
              <XCircle className="mr-1 inline h-3.5 w-3.5" />
              {result.error ?? 'Alert run failed.'}
            </p>
          )}
        </div>
      ) : null}
    </div>
  );
}
