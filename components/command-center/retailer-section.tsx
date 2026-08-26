import Link from 'next/link';
import { Store } from 'lucide-react';
import type { RetailerIntel } from '@/lib/admin/command-center/types';
import { Card } from '@/components/ui/card';
import { DataTable, dateOnly, GrowthText, inr, LinkPill, pct, Section, SectionEmptyState, Td, TagPill, tagTone } from './shared';

/**
 * Retailer Intelligence — active/inactive/new/high-value/declining/increasing
 * classification over real order windows (30/30 days) plus the existing
 * credit fields. No retailer data is exposed beyond Super Admin RLS.
 */
export function RetailerSection({ intel }: { intel: RetailerIntel }) {
  return (
    <Section
      title="Retailer intelligence"
      subtitle="Classification from real order history — 60-day windows, ₹500 materiality for trend calls."
      icon={Store}
      status={intel.status}
      actions={<LinkPill href="/admin/retailers">Retailer management</LinkPill>}
    >
      {intel.status === 'empty' ? (
        <SectionEmptyState title="No retailers yet" body="Retailer intelligence activates once retailers are approved and start ordering." />
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-7">
            <CountCard label="Active" value={intel.counts.active} />
            <CountCard label="Inactive 45d+" value={intel.counts.inactive} tone={intel.counts.inactive > 0 ? 'warn' : 'default'} />
            <CountCard label="New (30d)" value={intel.counts.new30d} />
            <CountCard label="High value" value={intel.counts.highValue} />
            <CountCard label="Declining" value={intel.counts.declining} tone={intel.counts.declining > 0 ? 'bad' : 'default'} />
            <CountCard label="Increasing" value={intel.counts.increasing} tone={intel.counts.increasing > 0 ? 'good' : 'default'} />
            <CountCard label="Over limit" value={intel.counts.overLimit} tone={intel.counts.overLimit > 0 ? 'bad' : 'default'} />
          </div>

          {intel.rows.length === 0 ? (
            <SectionEmptyState title="No retailer activity to rank" body="Once retailers place orders, the top 25 by 60-day sales appear here with frequency, AOV, trend and credit utilization." />
          ) : (
            <DataTable
              headers={['Retailer', 'Sales (60d)', 'Orders', 'Freq/mo', 'AOV', 'Trend', 'Last order', 'Credit use', 'Tags']}
              caption="Retailer intelligence ranking"
            >
              {intel.rows.map((row) => (
                <tr key={row.retailerId}>
                  <Td>
                    <Link href={`/admin/retailers/${row.retailerId}`} className="font-medium text-ink-900 hover:text-primary-700">
                      {row.shopName}
                    </Link>
                  </Td>
                  <Td>{inr(row.sales60d)}</Td>
                  <Td>{row.orders60d}</Td>
                  <Td>{row.frequencyPerMonth ?? '—'}</Td>
                  <Td>{row.aov60d === null ? '—' : inr(row.aov60d)}</Td>
                  <Td><GrowthText value={row.salesChangePct} /></Td>
                  <Td>{row.lastOrderAt ? dateOnly(row.lastOrderAt) : 'never'}</Td>
                  <Td>{row.creditUtilizationPct === null ? <span className="text-ink-400">no limit</span> : pct(row.creditUtilizationPct)}</Td>
                  <Td>
                    <div className="flex max-w-[220px] flex-wrap gap-1">
                      {row.tags.length === 0 ? <span className="text-[10px] text-ink-400">—</span> : row.tags.map((tag) => <TagPill key={tag} label={tag} tone={tagTone(tag)} />)}
                    </div>
                  </Td>
                </tr>
              ))}
            </DataTable>
          )}

          <Card className="p-4">
            <p className="text-[11px] leading-5 text-ink-500">
              {intel.dataNotes.map((note) => <span key={note} className="block">{note}</span>)}
            </p>
          </Card>
        </div>
      )}
    </Section>
  );
}

function CountCard({ label, value, tone = 'default' }: { label: string; value: number; tone?: 'default' | 'bad' | 'good' | 'warn' }) {
  const cls = tone === 'bad' ? 'text-red-600' : tone === 'warn' ? 'text-amber-600' : tone === 'good' ? 'text-emerald-600' : 'text-ink-950';
  return (
    <Card className="p-4">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-ink-400">{label}</p>
      <p className={`mt-1.5 text-lg font-bold ${cls}`}>{value}</p>
    </Card>
  );
}
