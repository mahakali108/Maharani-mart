import Link from 'next/link';
import {
  ChevronRight,
  CircleHelp,
  CreditCard,
  Headset,
  PackageSearch,
  Phone,
  Truck,
  WalletCards,
} from 'lucide-react';

const FAQ = [
  {
    q: 'How are wholesale prices calculated?',
    a: 'Maharani Traders applies your retailer or area price on the server. The price you see is a preview — checkout recalculates it and never trusts a browser-submitted amount.',
  },
  {
    q: 'Why can’t I add less than the MOQ?',
    a: 'Each pack has a minimum order quantity. The cart and checkout both re-check MOQ before an order is created.',
  },
  {
    q: 'How does business credit work?',
    a: 'If your distributor has set a credit limit, new orders cannot exceed available credit. Outstanding balance and remaining credit are shown at checkout and validated again when you place the order.',
  },
  {
    q: 'Can I cancel or return an order?',
    a: 'Pending orders can be cancelled. Delivered orders can request a return. Both actions are checked against the real order status on the server.',
  },
  {
    q: 'Where do invoices come from?',
    a: 'Open any confirmed or later order and choose Invoice. Totals on the invoice are the amounts stored when the order was placed.',
  },
];

export default function HelpPage({
  searchParams,
}: {
  searchParams: { topic?: string; order?: string };
}) {
  const phone = process.env.COMPANY_PHONE?.trim();
  const company = process.env.COMPANY_NAME?.trim() || 'Maharani Traders';
  const topic = searchParams.topic ?? '';
  const orderNumber = searchParams.order ?? '';

  return (
    <div className="space-y-5 sm:space-y-6">
      <div className="flex items-center gap-1.5 text-[10px] font-semibold text-slate-500 sm:text-xs">
        <Link href="/retailer/home" className="hover:text-primary-600">Home</Link>
        <ChevronRight className="h-3 w-3" />
        <span className="text-slate-800">Help</span>
      </div>

      <section className="rounded-2xl bg-gradient-to-r from-slate-950 via-slate-900 to-primary-950 p-5 text-white shadow-lg sm:p-8">
        <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-amber-300">Retailer support</p>
        <h1 className="mt-2 text-2xl font-bold sm:text-4xl">Help centre</h1>
        <p className="mt-2 max-w-xl text-xs text-slate-300 sm:text-sm">
          Get help with orders, payments, products and delivery — without leaving Maharani Traders.
        </p>
      </section>

      {orderNumber ? (
        <div className="rounded-2xl border border-blue-200 bg-blue-50 px-4 py-3 text-xs text-blue-800">
          Support request for order <span className="font-mono font-bold">{orderNumber}</span>. Share this number when you contact your distributor.
        </div>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2">
        {[
          { href: '/retailer/orders', icon: CircleHelp, title: 'Order issue', body: 'Track, invoice, reorder or cancel a pending order.' },
          { href: '/retailer/home', icon: WalletCards, title: 'Payment / credit issue', body: 'Review available credit and outstanding balance.' },
          { href: '/retailer/catalog', icon: PackageSearch, title: 'Product issue', body: 'Check pack size, GST or current wholesale price.' },
          { href: '/retailer/orders?status=dispatched', icon: Truck, title: 'Delivery issue', body: 'Follow orders that are packed or on the way.' },
        ].map((item) => (
          <Link key={item.title} href={item.href} className={`rounded-2xl border bg-white p-4 shadow-sm transition hover:border-primary-200 ${topic && item.title.toLowerCase().includes(topic) ? 'border-primary-300 ring-1 ring-primary-200' : 'border-slate-200'}`}>
            <item.icon className="h-5 w-5 text-primary-600" />
            <h2 className="mt-3 text-sm font-bold text-slate-900">{item.title}</h2>
            <p className="mt-1 text-[11px] text-slate-500">{item.body}</p>
          </Link>
        ))}
      </div>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex items-center gap-2">
          <Headset className="h-5 w-5 text-primary-600" />
          <h2 className="text-sm font-bold text-slate-900">Contact your distributor</h2>
        </div>
        <p className="mt-2 text-xs leading-5 text-slate-500">
          {company} support is handled by your assigned distributor. Use the number below if it has been configured for this deployment.
        </p>
        {phone ? (
          <a href={`tel:${phone}`} className="mt-4 inline-flex h-11 items-center gap-2 rounded-xl bg-primary-600 px-4 text-xs font-bold text-white">
            <Phone className="h-4 w-4" /> Call {phone}
          </a>
        ) : (
          <p className="mt-4 rounded-xl bg-slate-50 px-3 py-3 text-xs text-slate-600">
            A support phone number has not been configured yet. Ask your Maharani Traders distributor for the shop helpline.
          </p>
        )}
      </section>

      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <CreditCard className="h-4 w-4 text-primary-600" />
          <h2 className="text-sm font-bold text-slate-900">Frequently asked questions</h2>
        </div>
        <div className="space-y-2">
          {FAQ.map((item) => (
            <article key={item.q} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <h3 className="text-sm font-bold text-slate-900">{item.q}</h3>
              <p className="mt-1.5 text-xs leading-5 text-slate-500">{item.a}</p>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
