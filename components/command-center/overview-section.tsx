import type { ReactNode } from 'react';
import Link from 'next/link';
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Bell,
  Boxes,
  IndianRupee,
  Package,
  Siren,
  Sparkles,
  TrendingUp,
  UserPlus,
  Users,
  Wallet,
  type LucideIcon,
} from 'lucide-react';
import type { CommandCenterData } from '@/lib/admin/command-center/types';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { TrendChart } from './charts';
import { RunAlertsButton } from './run-alerts-button';
import { ActionCenterList } from './action-center';
import {
  dateTime,
  GrowthText,
  inr,
  inrExact,
  pct,
  Section,
  SectionEmptyState,
} from './shared';

function Kpi({
  label,
  value,
  hint,
  tone = 'default',
  icon: Icon,
}: {
  label: string;
  value: string;
  hint?: ReactNode;
  tone?: 'default' | 'good' | 'warn' | 'bad';
  icon?: LucideIcon;
}) {
  const toneCls = tone === 'bad' ? 'text-red-600' : tone === 'warn' ? 'text-amber-600' : tone === 'good' ? 'text-emerald-600' : 'text-ink-950';
  return (
    <Card className="p-4">
      <div className="flex items-center justify-between">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-ink-400">{label}</p>
        {Icon ? <Icon className={`h-3.5 w-3.5 ${tone === 'bad' ? 'text-red-400' : 'text-ink-300'}`} /> : null}
      </div>
      <p className={`mt-1.5 truncate text-lg font-bold ${toneCls}`} title={value}>
        {value}
      </p>
      {hint ? <div className="mt-0.5 text-[11px] text-ink-500">{hint}</div> : null}
    </Card>
  );
}

export function OverviewSection({ data }: { data: CommandCenterData }) {
  const { overview, trends, risk, actions, ai } = data;
  const urgentActions = actions.filter((a) => a.severity === 'urgent').slice(0, 4);
  const hasAnyData =
    overview.status !== 'unavailable' &&
    (overview.monthOrders > 0 || overview.totalRetailers > 0 || overview.inventoryValue > 0);

  return (
    <div className="space-y-8">
      {/* 1 — Critical alerts (top priority) */}
      <Section
        title="Critical alerts"
        subtitle="Urgent signals evaluated from live data — stock-out, credit, expiry and system failures."
        icon={Siren}
        status={risk.status}
        actions={<RunAlertsButton />}
      >
        {urgentActions.length === 0 ? (
          <Card className="flex items-center gap-3 border-emerald-200 bg-emerald-50/50 p-4">
            <Activity className="h-5 w-5 text-emerald-600" />
            <p className="text-sm text-emerald-800">
              No urgent signals right now. The alert check covers stock-out risk, credit over-limit, batch expiry, unusual orders and system failures.
            </p>
          </Card>
        ) : (
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            {urgentActions.map((action) => (
              <Card key={action.id} className="border-red-200 bg-red-50/40 p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <AlertTriangle className="h-4 w-4 shrink-0 text-red-600" />
                      <p className="truncate text-sm font-semibold text-red-900">{action.entity}</p>
                    </div>
                    <p className="mt-1 text-xs leading-5 text-red-800">{action.reason}</p>
                    <p className="mt-1.5 text-[11px] text-red-700">
                      <span className="font-semibold">Action:</span> {action.recommendedAction}
                    </p>
                  </div>
                  {action.entityHref ? (
                    <Link
                      href={action.entityHref}
                      className="shrink-0 rounded-lg border border-red-200 bg-white px-2.5 py-1.5 text-[11px] font-bold text-red-700 transition hover:bg-red-100"
                    >
                      View
                    </Link>
                  ) : null}
                </div>
              </Card>
            ))}
          </div>
        )}
        {data.notifications.length > 0 ? (
          <div className="mt-3">
            <div className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-ink-600">
              <Bell className="h-3.5 w-3.5" /> {data.notifications.length} unread alert notification(s)
            </div>
            <Card className="divide-y divide-ink-50 p-0">
              {data.notifications.slice(0, 5).map((n) => (
                <div key={n.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                  <div className="min-w-0">
                    <p className="truncate text-xs font-medium text-ink-800">{n.title}</p>
                    <p className="truncate text-[11px] text-ink-500">{n.body}</p>
                  </div>
                  <span className="shrink-0 text-[10px] text-ink-400">{dateTime(n.createdAt)}</span>
                </div>
              ))}
            </Card>
          </div>
        ) : null}
      </Section>

      {/* 2 — Business health */}
      <Section
        title="Business health"
        subtitle={`Live KPIs from authorized data · as of ${dateTime(overview.dataAsOf)} (server time) · non-cancelled order basis`}
        icon={Activity}
        status={overview.status}
      >
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-7">
          <Kpi label="Today's sales" value={inr(overview.todaySales)} tone={overview.todaySales > 0 ? 'good' : 'default'} icon={IndianRupee} />
          <Kpi label="Today's orders" value={String(overview.todayOrders)} />
          <Kpi label="Monthly sales" value={inr(overview.monthSales)} hint={<GrowthText value={overview.salesMoMChangePct} />} />
          <Kpi label="Monthly orders" value={String(overview.monthOrders)} />
          <Kpi label="30d revenue" value={inr(overview.revenue30d)} />
          <Kpi
            label="Credit outstanding"
            value={inr(overview.outstandingCredit)}
            tone={overview.overLimitAmount > 0 ? 'bad' : 'default'}
            hint={overview.overLimitAmount > 0 ? `${inr(overview.overLimitAmount)} over limits` : undefined}
            icon={Wallet}
          />
          <Kpi
            label="Inventory value"
            value={inr(overview.inventoryValue)}
            hint={`${overview.lowStockCount} low · ${overview.outOfStockCount} out`}
            icon={Boxes}
          />
        </div>

        <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-3">
          <Card className="p-4 lg:col-span-2">
            <div className="mb-2 flex items-center justify-between">
              <p className="text-xs font-semibold text-ink-700">Sales — last 14 days</p>
              <span className="text-[11px] text-ink-400">
                {trends.daily.length} days · {trends.daily.reduce((s, d) => s + d.orders, 0)} orders
              </span>
            </div>
            <TrendChart points={trends.daily} />
          </Card>
          <div className="grid grid-cols-1 gap-3">
            <Kpi
              label="Expiring batches"
              value={`${overview.expiredBatches + overview.expiringCriticalBatches} critical`}
              tone={overview.expiredBatches + overview.expiringCriticalBatches > 0 ? 'bad' : overview.expiringWarningBatches > 0 ? 'warn' : 'default'}
              hint={`${overview.expiredBatches} expired · ${overview.expiringCriticalBatches} critical · ${overview.expiringWarningBatches} warning`}
              icon={AlertTriangle}
            />
            <Kpi
              label="Dead stock (30d no sales)"
              value={inr(overview.deadStockValue)}
              tone={overview.deadStockValue > 0 ? 'warn' : 'default'}
              hint={`${overview.deadStockCount} product(s)`}
              icon={Package}
            />
            <Kpi
              label="Network"
              value={`${overview.activeRetailers} retailers`}
              hint={`${overview.activeSalesmen} salesmen · ${overview.activeStaff} staff · ${overview.supplierCount} suppliers · ${overview.pendingGrns} pending GRNs`}
              icon={Users}
            />
          </div>
        </div>
      </Section>

      {/* 3 — Trend cards */}
      <Section title="Trend cards" subtitle="Moments in the business — real data only; unavailable sources are labelled, never estimated." icon={TrendingUp} status={trends.status}>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
          <TrendCard icon={IndianRupee} label="Average order value (30d)" value={trends.aov30d === null ? 'No orders yet' : inrExact(trends.aov30d)} />
          <TrendCard icon={TrendingUp} label="Sales MoM" value={pct(overview.salesMoMChangePct)} hint={overview.salesMoMChangePct === null ? 'Previous month has no data' : 'Month vs previous month'} />
          <TrendCard icon={UserPlus} label="New retailers (30d)" value={String(trends.newRetailers30d)} hint="Approved or created in the last 30 days" />
          <TrendCard icon={Users} label="Returning retailers (7d)" value={String(trends.returningRetailers7d)} hint="Ordered in last 7 days with history before that" />
          <TrendCard
            icon={Wallet}
            label="Credit collection trend"
            value="Not recorded"
            hint="No payment ledger exists in the platform yet — never estimated"
          />
        </div>
      </Section>

      {/* 4 — AI insights */}
      <Section
        title="AI insights"
        subtitle={`Demand-forecast engine over a ${ai.windowDays}-day window · ${ai.productsForecast} product(s) analysed`}
        icon={Sparkles}
        status={ai.status}
        actions={
          <Link href="/admin/command-center?tab=copilot" className="inline-flex items-center gap-1 rounded-lg bg-ink-950 px-3 py-1.5 text-[11px] font-bold text-white transition hover:bg-ink-800">
            Ask the copilot <ArrowRight className="h-3 w-3" />
          </Link>
        }
      >
        {ai.productsForecast === 0 && ai.status === 'ok' ? (
          <SectionEmptyState
            title="Not enough order history yet"
            body="Forecasts activate automatically once real orders exist (minimum 14 days of history). No synthetic numbers are shown."
          />
        ) : (
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
            <Card className="p-4 lg:col-span-1">
              <p className="text-xs leading-5 text-ink-700">{ai.narrative}</p>
            </Card>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:col-span-2">
              {ai.insights.length === 0 ? (
                <Card className="flex items-center p-4 text-sm text-ink-500 sm:col-span-2">No forecast signals in this window.</Card>
              ) : (
                ai.insights.slice(0, 6).map((insight, index) => (
                  <Card
                    key={`${insight.kind}-${insight.productId ?? index}`}
                    className={`p-3.5 ${insight.severity === 'critical' ? 'border-red-200 bg-red-50/40' : insight.severity === 'warning' ? 'border-amber-200 bg-amber-50/40' : ''}`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <p className="truncate text-xs font-semibold text-ink-900">{insight.title}</p>
                      <span
                        className={`shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase ${
                          insight.severity === 'critical' ? 'bg-red-600 text-white' : insight.severity === 'warning' ? 'bg-amber-100 text-amber-700' : 'bg-ink-100 text-ink-500'
                        }`}
                      >
                        {insight.severity}
                      </span>
                    </div>
                    <p className="mt-1 text-[11px] leading-4 text-ink-600">{insight.detail}</p>
                    <p className="mt-1.5 text-[9px] text-ink-400">Estimate · {insight.trace}</p>
                  </Card>
                ))
              )}
            </div>
          </div>
        )}
      </Section>

      {/* 5 — Executive action center */}
      <Section
        title="Executive action center"
        subtitle="Prioritized, data-backed actions. Each item names its source and the existing workflow that must execute it — the platform and AI never mutate."
        icon={Activity}
        status={actions.length > 0 ? 'ok' : risk.status}
      >
        {actions.length === 0 ? (
          <SectionEmptyState title="No actions required right now" body="Actions appear automatically when real signals fire — stock-out risk, credit exposure, expiry, unusual orders, declines or system failures." />
        ) : (
          <ActionCenterList actions={actions} limit={12} />
        )}
      </Section>

      {/* 6 — Quick links to the existing modules (no duplicated workflows) */}
      <Section title="Deep links" subtitle="Every workflow below already exists — the Command Center points at it, never rebuilds it." icon={ArrowRight}>
        <div className="flex flex-wrap gap-2">
          {[
            { label: 'Reports', href: '/admin/reports', icon: TrendingUp },
            { label: 'Demand forecast', href: '/admin/inventory/forecast', icon: Sparkles },
            { label: 'Low stock', href: '/admin/inventory/low-stock', icon: Package },
            { label: 'Expiry report', href: '/admin/inventory/expiry', icon: AlertTriangle },
            { label: 'GRNs', href: '/admin/inventory/grn', icon: Boxes },
            { label: 'Orders', href: '/admin/orders', icon: Activity },
            { label: 'Retailers', href: '/admin/retailers', icon: Users },
            { label: 'Team', href: '/admin/team', icon: Users },
            { label: 'Notifications', href: '/admin/notifications', icon: Bell },
          ].map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="inline-flex items-center gap-1.5 rounded-xl border border-ink-200 bg-white px-3 py-2 text-xs font-semibold text-ink-700 transition hover:border-primary-300 hover:text-primary-700"
            >
              <link.icon className="h-3.5 w-3.5" /> {link.label}
            </Link>
          ))}
        </div>
      </Section>

      {!hasAnyData ? (
        <Card className="border-primary-100 bg-primary-50/40 p-5">
          <CardHeader>
            <CardTitle>Welcome to the Command Center</CardTitle>
          </CardHeader>
          <p className="text-sm text-ink-600">
            The numbers above are real and currently empty because the platform has no order history yet. As products, stock, GRNs and orders are entered
            through the existing admin workflows, every section here activates automatically — nothing is faked in the meantime.
          </p>
        </Card>
      ) : null}
    </div>
  );
}

function TrendCard({ icon: Icon, label, value, hint }: { icon: LucideIcon; label: string; value: string; hint?: string }) {
  return (
    <Card className="p-4">
      <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wide text-ink-400">
        <Icon className="h-3.5 w-3.5" /> {label}
      </div>
      <p className="mt-1.5 truncate text-base font-bold text-ink-950" title={value}>
        {value}
      </p>
      {hint ? <p className="mt-0.5 text-[10px] leading-4 text-ink-400">{hint}</p> : null}
    </Card>
  );
}
