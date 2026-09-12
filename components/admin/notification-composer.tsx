'use client';

import { useState, useTransition } from 'react';
import { Loader2, Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { broadcastNotificationAction, type BroadcastResult } from '@/lib/admin/notifications-actions';
import { BROADCAST_AUDIENCES, type BroadcastAudience } from '@/lib/notifications/broadcast';

/**
 * Admin broadcast composer. Audiences are a closed server-defined set;
 * recipients are resolved server-side from real profiles/retailers rows.
 */
export function NotificationComposer() {
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [linkUrl, setLinkUrl] = useState('');
  const [audience, setAudience] = useState<BroadcastAudience>('active_retailers');
  const [category, setCategory] = useState<'transactional' | 'promotional'>('transactional');
  const [result, setResult] = useState<BroadcastResult | null>(null);
  const [isPending, startTransition] = useTransition();

  function submit() {
    setResult(null);
    startTransition(async () => {
      const outcome = await broadcastNotificationAction({
        title,
        body,
        linkUrl: linkUrl || undefined,
        audience,
        category,
      });
      setResult(outcome);
      if ('success' in outcome) {
        setTitle('');
        setBody('');
        setLinkUrl('');
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
          Sent to {result.recipients} recipient{result.recipients === 1 ? '' : 's'}.
          {result.warning ? <span className="block text-amber-700">{result.warning}</span> : null}
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="broadcast-title">Title</Label>
          <Input id="broadcast-title" type="text" maxLength={120} value={title} onChange={(e) => setTitle(e.target.value)} disabled={isPending} required />
        </div>
        <div>
          <Label htmlFor="broadcast-audience">Audience</Label>
          <Select id="broadcast-audience" value={audience} onChange={(e) => setAudience(e.target.value as BroadcastAudience)} disabled={isPending}>
            {BROADCAST_AUDIENCES.map((a) => (
              <option key={a.value} value={a.value}>
                {a.label}
              </option>
            ))}
          </Select>
        </div>
        <div className="sm:col-span-2">
          <Label htmlFor="broadcast-body">Message</Label>
          <textarea
            id="broadcast-body"
            rows={3}
            maxLength={1000}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            disabled={isPending}
            required
            className="w-full rounded-xl border border-ink-200 bg-white px-3.5 py-2.5 text-sm text-ink-900 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-primary-600"
          />
        </div>
        <div>
          <Label htmlFor="broadcast-link">In-app link (optional)</Label>
          <Input id="broadcast-link" type="text" maxLength={300} placeholder="/retailer/schemes" value={linkUrl} onChange={(e) => setLinkUrl(e.target.value)} disabled={isPending} />
          <p className="mt-1 text-xs text-ink-400">Internal path only, e.g. /retailer/schemes.</p>
        </div>
        <div>
          <Label htmlFor="broadcast-category">Category</Label>
          <Select
            id="broadcast-category"
            value={category}
            onChange={(e) => setCategory(e.target.value as 'transactional' | 'promotional')}
            disabled={isPending}
          >
            <option value="transactional">Transactional (always delivered)</option>
            <option value="promotional">Promotional (respects retailer preferences)</option>
          </Select>
        </div>
      </div>

      <Button type="submit" size="sm" disabled={isPending || !title || !body}>
        {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        Send notification
      </Button>
    </form>
  );
}
