import { MapPin, UserCog } from 'lucide-react';
import type { SalesmanIntel } from '@/lib/admin/command-center/types';
import { Card } from '@/components/ui/card';
import { DataTable, inr, LinkPill, Section, SectionEmptyState, TagPill, Td, GrowthText } from './shared';

/**
 * Salesman Intelligence — from real orders.collected_by data, visits and
 * routes. Metrics that have no source data (targets) are explicitly omitted.
 */
export function SalesmanSection({ intel }: { intel: SalesmanIntel }) {
  return (
    <Section
      title="Salesman intelligence"
      subtitle="30-day field performance from orders captured by each salesman."
      icon={UserCog}
      status={intel.status}
      actions={
        <div className="flex flex-wrap gap-2">
          <LinkPill href="/admin/team">Team</LinkPill>
          <LinkPill href="/admin/visits">Visits</LinkPill>
        </div>
      }
    >
      {intel.status === 'empty' ? (
        <SectionEmptyState
          title="No active salesmen"
          body="Salesman intelligence appears once active salesman profiles exist. Create staff via the existing Team workflow."
        />
      ) : (
        <div className="space-y-4">
          <DataTable
            headers={['Salesman', 'Sales (30d)', 'Orders', 'AOV', 'Active retailers', 'Visits (30d)', 'Trend', 'Status']}
            caption="Salesman performance"
          >
            {intel.rows.map((row) => (
              <tr key={row.profileId}>
                <Td className="font-medium text-ink-900">{row.name}</Td>
                <Td>{inr(row.sales30d)}</Td>
                <Td>{row.orders30d}</Td>
                <Td>{row.aov30d === null ? '—' : inr(row.aov30d)}</Td>
                <Td>{row.activeRetailers30d}</Td>
                <Td>
                  {intel.hasVisitData ? (
                    <span className="inline-flex items-center gap-1">{row.visits30d} <MapPin className="h-3 w-3 text-ink-300" /></span>
                  ) : (
                    <span className="text-ink-400">no visit data</span>
                  )}
                </Td>
                <Td><GrowthText value={row.salesChangePct} /></Td>
                <Td>
                  <TagPill
                    label={row.status}
                    tone={row.status === 'active' ? 'good' : 'warn'}
                  />
                </Td>
              </tr>
            ))}
          </DataTable>

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
