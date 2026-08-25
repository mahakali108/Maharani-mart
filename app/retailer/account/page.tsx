import Link from 'next/link';
import {
  ArrowRight,
  Bell,
  ChevronRight,
  CircleHelp,
  ClipboardList,
  Heart,
  LogOut,
  MapPin,
  MessageCircle,
  Phone,
  ShieldCheck,
  ShoppingBag,
  Sparkles,
  UserRound,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { requireUser } from '@/lib/auth/session';
import { logoutAction } from '@/lib/auth/actions';
import { CreditSummary } from '@/components/retailer/credit-summary';

interface RetailerAccountRow {
  shop_name: string;
  gstin: string | null;
  address: string | null;
  credit_limit: number;
  outstanding_balance: number;
  status: string;
  areas: { name: string; district: string } | null;
}

interface ProfileContactRow {
  phone: string;
}

const ACCOUNT_LINKS = [
  { href: '/retailer/ai', label: 'Ask Maharani AI', body: 'Smart products, orders, credit and reorders', icon: Sparkles, tone: 'bg-blue-50 text-blue-700' },
  { href: '/retailer/orders', label: 'Orders', body: 'Track deliveries, invoices and reorders', icon: ClipboardList, tone: 'bg-blue-50 text-blue-700' },
  { href: '/retailer/quick-order', label: 'Quick Order', body: 'Find products by name or SKU', icon: ShoppingBag, tone: 'bg-amber-50 text-amber-700' },
  { href: '/retailer/favorites', label: 'Favourites', body: 'Your saved products for faster restocking', icon: Heart, tone: 'bg-rose-50 text-rose-700' },
  { href: '/retailer/notifications', label: 'Notifications', body: 'Order and account updates', icon: Bell, tone: 'bg-violet-50 text-violet-700' },
  { href: '/retailer/help', label: 'Help', body: 'FAQs and distributor support', icon: CircleHelp, tone: 'bg-emerald-50 text-emerald-700' },
];

export default async function RetailerAccountPage() {
  const user = await requireUser();
  const supabase = createClient();

  const [{ data: retailer }, { data: profile }, { count: orderCount }, { count: unreadCount }] = await Promise.all([
    supabase
      .from('retailers')
      .select('shop_name, gstin, address, credit_limit, outstanding_balance, status, areas ( name, district )')
      .eq('id', user.id)
      .maybeSingle<RetailerAccountRow>(),
    supabase.from('profiles').select('phone').eq('id', user.id).maybeSingle<ProfileContactRow>(),
    supabase.from('orders').select('id', { count: 'exact', head: true }).eq('retailer_id', user.id),
    supabase.from('notifications').select('id', { count: 'exact', head: true }).eq('recipient_id', user.id).eq('is_read', false),
  ]);

  const shopName = retailer?.shop_name ?? user.fullName;
  const area = retailer?.areas ? `${retailer.areas.name}${retailer.areas.district ? `, ${retailer.areas.district}` : ''}` : null;
  const initials = shopName
    .split(' ')
    .map((part) => part[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();

  return (
    <div className="space-y-6 sm:space-y-8">
      <div className="flex items-center gap-1.5 text-[10px] font-semibold text-slate-500 sm:text-xs">
        <Link href="/retailer/home" className="hover:text-primary-600">Home</Link>
        <ChevronRight className="h-3 w-3" />
        <span className="text-slate-800">Account</span>
      </div>

      <section className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-blue-700 via-blue-800 to-slate-950 p-5 text-white shadow-lg sm:p-8">
        <UserRound className="absolute -bottom-8 -right-3 h-44 w-44 text-white/10 sm:h-60 sm:w-60" />
        <div className="relative flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-4">
            <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-white text-xl font-black text-blue-700 shadow-sm sm:h-20 sm:w-20 sm:text-2xl">
              {initials || 'MT'}
            </span>
            <div>
              <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.2em] text-blue-200">
                <Sparkles className="h-3.5 w-3.5" /> Retailer account
              </p>
              <h1 className="mt-1 text-2xl font-bold tracking-tight sm:text-4xl">{shopName}</h1>
              <p className="mt-1 text-xs text-blue-100 sm:text-sm">Manage your shop profile, credit and marketplace shortcuts.</p>
            </div>
          </div>
          <span className="inline-flex w-fit items-center gap-1.5 rounded-full bg-emerald-400/20 px-3 py-1.5 text-[10px] font-bold text-emerald-100">
            <ShieldCheck className="h-3.5 w-3.5" /> {retailer?.status === 'active' ? 'Account active' : retailer?.status ?? 'Retailer'}
          </span>
        </div>
      </section>

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_360px] lg:gap-7">
        <div className="space-y-5">
          <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="flex items-center justify-between border-b border-slate-100 px-4 py-4 sm:px-5">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-primary-600">Your details</p>
                <h2 className="mt-0.5 text-base font-bold text-slate-900">Retailer / shop information</h2>
              </div>
              <UserRound className="h-5 w-5 text-primary-600" />
            </div>
            <dl className="grid gap-x-6 gap-y-4 p-4 sm:grid-cols-2 sm:p-5">
              <div>
                <dt className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Shop name</dt>
                <dd className="mt-1 text-sm font-semibold text-slate-900">{shopName}</dd>
              </div>
              <div>
                <dt className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Contact person</dt>
                <dd className="mt-1 text-sm font-semibold text-slate-900">{user.fullName}</dd>
              </div>
              <div>
                <dt className="text-[10px] font-bold uppercase tracking-wider text-slate-400">GSTIN</dt>
                <dd className="mt-1 font-mono text-sm font-semibold text-slate-900">{retailer?.gstin ?? 'Not provided'}</dd>
              </div>
              <div>
                <dt className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Email</dt>
                <dd className="mt-1 truncate text-sm font-semibold text-slate-900">{user.email ?? 'Not provided'}</dd>
              </div>
              <div>
                <dt className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Phone</dt>
                <dd className="mt-1 flex items-center gap-1.5 text-sm font-semibold text-slate-900"><Phone className="h-3.5 w-3.5 text-slate-400" /> {profile?.phone ?? 'Not provided'}</dd>
              </div>
              <div>
                <dt className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Service area</dt>
                <dd className="mt-1 flex items-center gap-1.5 text-sm font-semibold text-slate-900"><MapPin className="h-3.5 w-3.5 text-slate-400" /> {area ?? 'Assigned area'}</dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Shop address</dt>
                <dd className="mt-1 text-sm font-semibold text-slate-900">{retailer?.address ?? 'Address not provided'}</dd>
              </div>
            </dl>
          </section>

          <section className="space-y-3">
            <div className="flex items-end justify-between gap-3">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-primary-600">Stay in control</p>
                <h2 className="mt-0.5 text-base font-bold text-slate-900 sm:text-xl">Account shortcuts</h2>
              </div>
              {unreadCount && unreadCount > 0 ? <span className="rounded-full bg-blue-50 px-2.5 py-1 text-[10px] font-bold text-blue-700">{unreadCount} unread</span> : null}
            </div>
            <div className="grid gap-2.5 sm:grid-cols-2">
              {ACCOUNT_LINKS.map((item) => {
                const Icon = item.icon;
                return (
                  <Link key={item.href} href={item.href} className="group flex items-center gap-3 rounded-2xl border border-slate-200 bg-white p-3.5 shadow-sm transition hover:-translate-y-0.5 hover:border-blue-200 hover:shadow-md sm:p-4">
                    <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${item.tone}`}><Icon className="h-5 w-5" /></span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-bold text-slate-900">{item.label}</span>
                      <span className="mt-0.5 block truncate text-[10px] text-slate-500">{item.body}</span>
                    </span>
                    <ArrowRight className="h-4 w-4 shrink-0 text-slate-300 transition group-hover:translate-x-0.5 group-hover:text-primary-600" />
                  </Link>
                );
              })}
            </div>
          </section>
        </div>

        <aside className="space-y-4 lg:sticky lg:top-36">
          {retailer ? <CreditSummary creditLimit={retailer.credit_limit} outstandingBalance={retailer.outstanding_balance} /> : null}
          <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
            <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-primary-600">At a glance</p>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <Link href="/retailer/orders" className="rounded-xl bg-slate-50 p-3 transition hover:bg-blue-50">
                <ClipboardList className="h-4 w-4 text-blue-700" />
                <p className="mt-2 text-lg font-bold text-slate-900">{orderCount ?? 0}</p>
                <p className="text-[10px] text-slate-500">Orders placed</p>
              </Link>
              <Link href="/retailer/notifications" className="rounded-xl bg-slate-50 p-3 transition hover:bg-blue-50">
                <Bell className="h-4 w-4 text-blue-700" />
                <p className="mt-2 text-lg font-bold text-slate-900">{unreadCount ?? 0}</p>
                <p className="text-[10px] text-slate-500">Unread updates</p>
              </Link>
            </div>
          </section>
          <Link href="/retailer/help" className="flex items-center gap-3 rounded-2xl border border-blue-100 bg-blue-50 p-4 transition hover:border-blue-200 hover:bg-blue-100">
            <MessageCircle className="h-5 w-5 text-blue-700" />
            <span className="flex-1"><span className="block text-xs font-bold text-blue-900">Need a hand?</span><span className="mt-0.5 block text-[10px] text-blue-700">Visit the retailer help centre</span></span>
            <ArrowRight className="h-4 w-4 text-blue-700" />
          </Link>
          <form action={logoutAction}>
            <button type="submit" className="flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white text-xs font-bold text-slate-600 shadow-sm transition hover:border-rose-200 hover:bg-rose-50 hover:text-rose-700">
              <LogOut className="h-4 w-4" /> Logout
            </button>
          </form>
        </aside>
      </div>
    </div>
  );
}
