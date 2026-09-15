import Link from 'next/link';
import { ChevronLeft, ChevronRight, LifeBuoy } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { requireUser } from '@/lib/auth/session';
import { SupportTicketForm } from '@/components/retailer/support-ticket-form';

interface OrderOptionRow {
  id: string;
  order_number: string;
  placed_at: string;
}

/**
 * Create a support ticket. The `?order=` parameter may carry an order id or
 * an order number (order detail passes the id; older help links pass the
 * number) — both are resolved against the CALLER'S OWN orders only, so a
 * tampered value can never pre-select someone else's order.
 */
export default async function NewSupportTicketPage({
  searchParams,
}: {
  searchParams: { order?: string };
}) {
  const user = await requireUser();
  const supabase = createClient();

  const [{ data: orderData }, preselectedId] = await (async () => {
    const { data } = await supabase
      .from('orders')
      .select('id, order_number, placed_at')
      .eq('retailer_id', user.id)
      .order('placed_at', { ascending: false })
      .limit(50);
    const orders = (data ?? []) as unknown as OrderOptionRow[];

    let preselect: string | null = null;
    const hint = (searchParams.order ?? '').trim();
    if (hint) {
      const byId = orders.find((order) => order.id === hint);
      const byNumber = orders.find((order) => order.order_number === hint);
      preselect = byId?.id ?? byNumber?.id ?? null;
    }
    return [
      { data: orders },
      preselect,
    ] as const;
  })();

  return (
    <div className="mx-auto max-w-2xl space-y-5 sm:space-y-6">
      <div className="flex items-center gap-1.5 text-[10px] font-semibold text-slate-500 sm:text-xs">
        <Link href="/retailer/home" className="hover:text-primary-600">
          Home
        </Link>
        <ChevronRight className="h-3 w-3" />
        <Link href="/retailer/support" className="hover:text-primary-600">
          Support
        </Link>
        <ChevronRight className="h-3 w-3" />
        <span className="text-slate-800">New ticket</span>
      </div>

      <section className="rounded-2xl border border-slate-200 bg-gradient-to-br from-primary-50 via-white to-rose-50/50 p-5 shadow-sm sm:p-7">
        <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-primary-600">Need a hand?</p>
        <h1 className="mt-2 text-xl font-bold tracking-tight text-slate-950 sm:text-2xl">Raise a support ticket</h1>
        <p className="mt-2 max-w-xl text-xs leading-5 text-slate-600 sm:text-sm">
          Tell us what&rsquo;s wrong. Your distributor gets a notification and replies here —
          the full conversation is kept on the ticket.
        </p>
      </section>

      <SupportTicketForm
        orders={(orderData ?? []).map((order) => ({
          id: order.id,
          orderNumber: order.order_number,
          placedAt: order.placed_at,
        }))}
        defaultOrderId={preselectedId}
      />

      <Link
        href="/retailer/support"
        className="inline-flex items-center gap-1 text-[10px] font-bold text-slate-600 hover:text-primary-600"
      >
        <ChevronLeft className="h-3.5 w-3.5" aria-hidden="true" /> Back to all tickets
      </Link>
      <div className="flex items-start gap-2 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-[10px] leading-4 text-blue-800 sm:text-xs">
        <LifeBuoy className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        <p>
          Tickets are private to you and your distributor. Statuses are <strong>Open → In progress → Resolved →
          Closed</strong>; you can reply while the ticket is open or in progress.
        </p>
      </div>
    </div>
  );
}
