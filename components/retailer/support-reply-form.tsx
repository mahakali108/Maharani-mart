'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Send } from 'lucide-react';
import { replyToSupportTicketAction } from '@/lib/retailer/support-actions';
import { Button } from '@/components/ui/button';

export function SupportReplyForm({ ticketId }: { ticketId: string }) {
  const router = useRouter();
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function submit() {
    setError(null);
    const text = value.trim();
    if (text.length < 5) {
      setError('Message must be at least 5 characters.');
      return;
    }
    startTransition(async () => {
      const result = await replyToSupportTicketAction(ticketId, text);
      if (result.error) {
        setError(result.error);
      } else {
        setValue('');
        router.refresh();
      }
    });
  }

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <label htmlFor="reply" className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
        Add a message
      </label>
      <textarea
        id="reply"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        rows={3}
        maxLength={3000}
        placeholder="Write a reply…"
        className="mt-2 w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-xs text-slate-900 outline-none focus:border-primary-300 focus:ring-2 focus:ring-primary-100"
      />
      {error ? <p role="alert" className="mt-2 text-xs font-medium text-primary-700">{error}</p> : null}
      <div className="mt-3 flex items-center justify-between gap-3">
        <p className="text-[10px] text-slate-400">Messages are visible to your distributor.</p>
        <Button onClick={submit} disabled={isPending || value.trim().length < 5} className="h-9">
          {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          {isPending ? 'Sending…' : 'Send'}
        </Button>
      </div>
    </div>
  );
}
