'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Send } from 'lucide-react';
import { createSupportTicketAction } from '@/lib/retailer/support-actions';
import { formatIndiaDate } from '@/lib/datetime/india';
import {
  SUPPORT_PRIORITIES,
  SUPPORT_PRIORITY_LABELS,
  SUPPORT_TOPICS,
  SUPPORT_TOPIC_LABELS,
  type SupportPriority,
  type SupportTopic,
} from '@/lib/retailer/support';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';

export interface SupportOrderOption {
  id: string;
  orderNumber: string;
  placedAt: string;
}

export function SupportTicketForm({
  orders,
  defaultOrderId,
}: {
  orders: SupportOrderOption[];
  defaultOrderId: string | null;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleSubmit(formData: FormData) {
    setError(null);
    const subject = String(formData.get('subject') ?? '').trim();
    const topic = String(formData.get('topic') ?? '');
    const priority = String(formData.get('priority') ?? '');
    const orderId = String(formData.get('orderId') ?? '');
    const description = String(formData.get('description') ?? '').trim();

    startTransition(async () => {
      const result = await createSupportTicketAction({
        subject,
        topic: topic as SupportTopic,
        priority: (priority || 'normal') as SupportPriority,
        orderId: orderId || null,
        description,
      });
      if ('error' in result) {
        if (result.error) setError(result.error);
      } else {
        router.push(`/retailer/support/${result.ticketId}`);
        router.refresh();
      }
    });
  }

  return (
    <form action={handleSubmit} className="space-y-4">
      <Card className="space-y-4 p-4 sm:p-5">
        <div className="space-y-1.5">
          <Label htmlFor="subject">Subject</Label>
          <Input
            id="subject"
            name="subject"
            required
            minLength={10}
            maxLength={120}
            placeholder="Short summary, e.g. GST on order MK-2026-0042 looks wrong"
            className="h-10"
          />
          <p className="text-[10px] text-slate-500">10–120 characters. This is what support sees first.</p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="topic">Category</Label>
            <select
              id="topic"
              name="topic"
              required
              defaultValue="order"
              className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-xs text-slate-900 outline-none focus:border-primary-300 focus:ring-2 focus:ring-primary-100"
            >
              {SUPPORT_TOPICS.map((topic) => (
                <option key={topic} value={topic}>
                  {SUPPORT_TOPIC_LABELS[topic]}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="priority">Priority</Label>
            <select
              id="priority"
              name="priority"
              required
              defaultValue="normal"
              className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-xs text-slate-900 outline-none focus:border-primary-300 focus:ring-2 focus:ring-primary-100"
            >
              {SUPPORT_PRIORITIES.map((priority) => (
                <option key={priority} value={priority}>
                  {SUPPORT_PRIORITY_LABELS[priority]}
                </option>
              ))}
            </select>
            <p className="text-[10px] text-slate-500">How urgent is this for your shop?</p>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-1">
          <div className="space-y-1.5">
            <Label htmlFor="orderId">Related order (optional)</Label>
            <select
              id="orderId"
              name="orderId"
              defaultValue={defaultOrderId ?? ''}
              className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-xs text-slate-900 outline-none focus:border-primary-300 focus:ring-2 focus:ring-primary-100"
            >
              <option value="">No specific order</option>
              {orders.map((order) => (
                <option key={order.id} value={order.id}>
                  {order.orderNumber} · {formatIndiaDate(order.placedAt)}
                </option>
              ))}
            </select>
            <p className="text-[10px] text-slate-500">Link the order this issue is about, when relevant.</p>
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="description">Describe the issue</Label>
          <textarea
            id="description"
            name="description"
            required
            minLength={10}
            maxLength={3000}
            rows={5}
            placeholder="What happened, what you expected, and any order or payment reference numbers."
            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-xs text-slate-900 outline-none focus:border-primary-300 focus:ring-2 focus:ring-primary-100"
          />
          <p className="text-[10px] text-slate-500">10–3,000 characters.</p>
        </div>

        {error ? (
          <div role="alert" className="rounded-xl border border-primary-200 bg-primary-50 px-4 py-3 text-sm text-primary-700">
            {error}
          </div>
        ) : null}

        <Button type="submit" className="h-11 w-full" disabled={isPending}>
          {isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Send className="h-4 w-4" />
          )}
          {isPending ? 'Creating ticket…' : 'Create support ticket'}
        </Button>
      </Card>
    </form>
  );
}
