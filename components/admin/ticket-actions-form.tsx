'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { CheckCircle2, Loader2, Lock, RotateCcw, Send } from 'lucide-react';
import { adminReplyToTicketAction, updateTicketStatusAction } from '@/lib/admin/support-actions';
import { SUPPORT_STATUS_LABELS, type SupportStatus } from '@/lib/retailer/support';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

/**
 * Admin-side controls: reply to the ticket and move it through the
 * workflow. Every mutation goes through a Server Action that re-checks
 * `support.manage`, and RLS (0048) independently restricts both writes to
 * admin+.
 */
export function TicketActionsForm({
  ticketId,
  status,
  allowReopen,
}: {
  ticketId: string;
  status: SupportStatus;
  /** Resolved tickets may be reopened (→ in_progress); closed ones may not. */
  allowReopen: boolean;
}) {
  const router = useRouter();
  const [reply, setReply] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [replying, startReplying] = useTransition();
  const [changingStatus, startChangingStatus] = useTransition();

  function sendReply() {
    setError(null);
    const text = reply.trim();
    if (text.length < 5) return;
    startReplying(async () => {
      const result = await adminReplyToTicketAction(ticketId, text);
      if (result.error) {
        setError(result.error);
      } else {
        setReply('');
        router.refresh();
      }
    });
  }

  function changeStatus(next: SupportStatus) {
    setError(null);
    setStatusMessage(null);
    startChangingStatus(async () => {
      const result = await updateTicketStatusAction(ticketId, next);
      if (result.error) {
        setError(result.error);
      } else {
        setStatusMessage(result.message ?? 'Status updated.');
        router.refresh();
      }
    });
  }

  const busy = replying || changingStatus;

  return (
    <Card className="space-y-4">
      <div>
        <h2 className="text-sm font-semibold text-ink-900">Reply</h2>
        <p className="mt-0.5 text-[11px] text-ink-500">
          The retailer is notified in-app. Replying to a fresh “open” ticket moves it to in progress.
        </p>
        <textarea
          value={reply}
          onChange={(e) => setReply(e.target.value)}
          rows={3}
          maxLength={3000}
          placeholder="Write a reply…"
          className="mt-2 w-full rounded-lg border border-ink-200 bg-white px-3 py-2.5 text-sm text-ink-900 outline-none focus:border-primary-300 focus:ring-2 focus:ring-primary-100"
        />
        <div className="mt-2 flex justify-end">
          <Button onClick={sendReply} disabled={busy || reply.trim().length < 5} size="sm">
            {replying ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            Send reply
          </Button>
        </div>
      </div>

      <div className="border-t border-ink-100 pt-4">
        <h2 className="text-sm font-semibold text-ink-900">Status</h2>
        <p className="mt-0.5 text-[11px] text-ink-500">
          Current: <strong>{SUPPORT_STATUS_LABELS[status]}</strong>. Allowed moves are enforced server-side.
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          {status === 'open' && (
            <Button variant="outline" size="sm" disabled={busy} onClick={() => changeStatus('in_progress')}>
              <RotateCcw className="h-3.5 w-3.5" /> Mark in progress
            </Button>
          )}
          {status === 'in_progress' && (
            <Button variant="outline" size="sm" disabled={busy} onClick={() => changeStatus('open')}>
              Reopen as open
            </Button>
          )}
          {status !== 'resolved' && status !== 'closed' && (
            <Button variant="outline" size="sm" disabled={busy} onClick={() => changeStatus('resolved')}>
              <CheckCircle2 className="h-3.5 w-3.5" /> Mark resolved
            </Button>
          )}
          {allowReopen && (
            <Button variant="outline" size="sm" disabled={busy} onClick={() => changeStatus('in_progress')}>
              <RotateCcw className="h-3.5 w-3.5" /> Reopen ticket
            </Button>
          )}
          {status !== 'closed' && (
            <Button variant="outline" size="sm" disabled={busy} onClick={() => changeStatus('closed')}>
              <Lock className="h-3.5 w-3.5" /> Close ticket
            </Button>
          )}
        </div>
        {status === 'closed' ? (
          <p className="mt-2 text-[11px] text-ink-500">Closed tickets are final — no further moves are allowed.</p>
        ) : null}
      </div>

      {error ? (
        <div role="alert" className="rounded-xl border border-primary-200 bg-primary-50 px-3 py-2.5 text-sm text-primary-700">
          {error}
        </div>
      ) : null}
      {statusMessage ? (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-sm text-emerald-700">
          {statusMessage}
        </div>
      ) : null}
    </Card>
  );
}
