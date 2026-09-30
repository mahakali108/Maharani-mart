'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { FlaskConical, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { runCleanupDryRun } from '@/lib/admin/cleanup-actions';

/**
 * The ONLY action on the retention page: run a dry-run audit. It counts
 * eligible rows and plans deletions but deletes nothing. Real cleanup runs
 * on the production scheduler only — there is intentionally no
 * "delete everything" control here (spec §23).
 */
export function CleanupDryRunButton() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  const onClick = () => {
    setMessage(null);
    startTransition(async () => {
      const result = await runCleanupDryRun();
      if (!result.ok) {
        setMessage(`Dry run failed: ${result.error}`);
        return;
      }
      const eligible = result.report.totals.temporary + result.report.totals['120_day'];
      setMessage(
        `Dry run ${result.report.run_id} complete — ${eligible} row(s) eligible for cleanup. Nothing was deleted.`
      );
      router.refresh();
    });
  };

  return (
    <div className="flex flex-col items-end gap-1.5">
      <Button variant="outline" size="sm" onClick={onClick} disabled={pending}>
        {pending ? (
          <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
        ) : (
          <FlaskConical className="mr-1.5 h-4 w-4" />
        )}
        Run Dry-Run Audit
      </Button>
      {message ? <p className="max-w-xs text-right text-xs text-ink-500">{message}</p> : null}
    </div>
  );
}
