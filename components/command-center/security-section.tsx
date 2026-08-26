import { Bot, BellOff, ClipboardList, ShieldCheck } from 'lucide-react';
import type { SecurityIntel } from '@/lib/admin/command-center/types';
import { Card } from '@/components/ui/card';
import { DataTable, dateTime, Section, SectionEmptyState, Td, TagPill } from './shared';

/**
 * Security & Audit Center — reads the EXISTING audit trail (audit_logs,
 * populated by database triggers), the AI observability table (ai_audit_logs)
 * and the notification delivery log. Curated summaries only: raw jsonb
 * payloads, phone numbers and credentials are never surfaced.
 */
export function SecuritySection({ security }: { security: SecurityIntel }) {
  return (
    <Section
      title="Security & audit center"
      subtitle="Who changed what and when — from the existing trigger-populated audit log and AI observability."
      icon={ShieldCheck}
      status={security.status}
    >
      <div className="space-y-4">
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
          <Card className="p-4">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-ink-700">
              <Bot className="h-3.5 w-3.5" /> AI / provider health (7d)
            </div>
            <div className="mt-2 flex items-baseline gap-3">
              <p className="text-2xl font-bold text-ink-950">{security.ai.requests7d}</p>
              <p className="text-xs text-ink-500">requests</p>
              <p className={`text-2xl font-bold ${security.ai.failures7d > 0 ? 'text-red-600' : 'text-emerald-600'}`}>{security.ai.failures7d}</p>
              <p className="text-xs text-ink-500">failures</p>
            </div>
            {security.ai.failedTools.length > 0 ? (
              <ul className="mt-2 space-y-1">
                {security.ai.failedTools.map((tool) => (
                  <li key={`${tool.tool}-${tool.code}`} className="flex items-center justify-between gap-2 text-[11px]">
                    <span className="truncate text-ink-600">{tool.tool}</span>
                    <span className="flex items-center gap-1.5">
                      <TagPill label={tool.code} tone="bad" /> ×{tool.count}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-[11px] text-emerald-700">No provider failures recorded in the last 7 days.</p>
            )}
          </Card>

          <Card className="p-4">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-ink-700">
              <BellOff className="h-3.5 w-3.5" /> Notification delivery failures (7d)
            </div>
            <p className={`mt-2 text-2xl font-bold ${security.failedNotifications7d > 0 ? 'text-amber-600' : 'text-ink-950'}`}>
              {security.failedNotifications7d}
            </p>
            <p className="mt-1 text-[11px] text-ink-500">
              {security.failedNotifications7d > 0 ? 'Channel delivery failures recorded in notification_logs.' : 'All recorded deliveries succeeded.'}
            </p>
          </Card>

          <Card className="p-4">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-ink-700">
              <ClipboardList className="h-3.5 w-3.5" /> Manual stock adjustments (7d)
            </div>
            <p className="mt-2 text-2xl font-bold text-ink-950">{security.recentAdjustments.length}</p>
            <p className="mt-1 text-[11px] text-ink-500">
              {security.recentAdjustments.length > 0
                ? 'Manual adjustments below — review for anomalies. Adjustments are the only way quantity changes outside orders/GRNs.'
                : 'No manual adjustments recorded in the last 7 days.'}
            </p>
          </Card>
        </div>

        {security.events.length === 0 ? (
          <SectionEmptyState
            title="No audited changes yet"
            body="The audit log is populated by database triggers on products, prices, orders and inventory records. Changes made by your team will appear here automatically."
          />
        ) : (
          <DataTable headers={['When', 'User', 'Table', 'Action', 'Change']} caption="Recent audited activity">
            {security.events.map((event) => (
              <tr key={event.id}>
                <Td className="whitespace-nowrap text-ink-500">{dateTime(event.createdAt)}</Td>
                <Td className="font-medium text-ink-900">{event.changedBy}</Td>
                <Td className="text-ink-500">{event.table}</Td>
                <Td>
                  <TagPill
                    label={event.action}
                    tone={event.action === 'update' ? 'warn' : event.action === 'delete' ? 'bad' : 'default'}
                  />
                </Td>
                <Td className="text-ink-600">{event.summary}</Td>
              </tr>
            ))}
          </DataTable>
        )}

        {security.recentAdjustments.length > 0 ? (
          <Card className="p-4">
            <p className="mb-2 text-xs font-semibold text-ink-700">Recent manual stock adjustments (last 7 days)</p>
            <DataTable headers={['When', 'Product', 'Qty', 'By', 'Reason']} caption="Stock adjustments">
              {security.recentAdjustments.map((a) => (
                <tr key={a.id}>
                  <Td className="whitespace-nowrap text-ink-500">{dateTime(a.at)}</Td>
                  <Td className="font-medium text-ink-900">{a.productName}</Td>
                  <Td>{a.qty}</Td>
                  <Td>{a.by ?? 'Unknown'}</Td>
                  <Td className="text-ink-500">{a.reason ?? '—'}</Td>
                </tr>
              ))}
            </DataTable>
          </Card>
        ) : null}

        <Card className="p-4">
          <p className="text-[11px] leading-5 text-ink-500">
            The audit trail is written by database triggers — it cannot be edited from the app. This view shows curated summaries only: raw record
            payloads, phone numbers, GSTINs and any credentials are never rendered here. Row Level Security for this table is staff+ read, and the
            Command Center route itself is Super Admin only.
          </p>
        </Card>
      </div>
    </Section>
  );
}
