'use client';

import { useState, useTransition } from 'react';
import { Loader2 } from 'lucide-react';
import { adminUpdateApprovalSettingsAction } from '@/lib/admin/retailer-approval-actions';

/**
 * Super Admin control for the retailer review SLA.
 *
 * This is a BUSINESS target (how quickly we aim to review an application), not
 * a legally mandated approval time, and the page says so.
 */
export function RetailerApprovalSlaForm({
  reviewTargetHours,
  reminderHours,
}: {
  reviewTargetHours: number;
  reminderHours: number;
}) {
  const [target, setTarget] = useState(String(reviewTargetHours));
  const [reminder, setReminder] = useState(String(reminderHours));
  const [feedback, setFeedback] = useState<{ error?: string; success?: string } | null>(null);
  const [isPending, startTransition] = useTransition();

  return (
    <form
      className="flex flex-wrap items-end gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData();
        data.set('reviewTargetHours', target);
        data.set('reminderHours', reminder);
        startTransition(async () => {
          const result = await adminUpdateApprovalSettingsAction(data).catch(() => ({
            error: 'The review target could not be saved.',
          }));
          setFeedback(result);
        });
      }}
    >
      <div>
        <label htmlFor="reviewTargetHours" className="block text-xs font-medium text-ink-600">
          Review target (hours)
        </label>
        <input
          id="reviewTargetHours"
          type="number"
          min={1}
          max={720}
          value={target}
          onChange={(event) => setTarget(event.target.value)}
          className="mt-1 h-9 w-28 rounded-lg border border-ink-200 px-2.5 text-sm"
        />
      </div>
      <div>
        <label htmlFor="reminderHours" className="block text-xs font-medium text-ink-600">
          Reminder interval (hours)
        </label>
        <input
          id="reminderHours"
          type="number"
          min={1}
          max={720}
          value={reminder}
          onChange={(event) => setReminder(event.target.value)}
          className="mt-1 h-9 w-28 rounded-lg border border-ink-200 px-2.5 text-sm"
        />
      </div>
      <button
        type="submit"
        disabled={isPending}
        className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary-600 px-3 text-xs font-semibold text-white hover:bg-primary-700 disabled:opacity-50"
      >
        {isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
        Save target
      </button>
      {feedback?.error ? <p className="text-xs font-medium text-warning-800">{feedback.error}</p> : null}
      {feedback?.success ? <p className="text-xs font-medium text-mint-700">{feedback.success}</p> : null}
    </form>
  );
}
