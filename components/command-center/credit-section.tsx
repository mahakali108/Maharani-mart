import Link from 'next/link';
import { ShieldAlert, Wallet } from 'lucide-react';
import type { CreditOverview } from '@/lib/admin/command-center/types';
import { Card } from '@/components/ui/card';
import { Donut } from './charts';
import { DataTable, inr, LinkPill, Section, SectionEmptyState, TagPill, Td } from './shared';

/**
 * Credit & Risk Control — aggregates the existing `retailers` credit fields
 * through the SAME shared calculator (calculateCreditPosition) used by
 * checkout and Maharani AI. There is no second credit system.
 *
 * Honest limitation: the schema has no payment/collection ledger, so
 * "payment trend" and "overdue" determination are reported as unavailable —
 * over-limit exposure (a real, computed position) is what the platform can
 * actually state.
 */
export function CreditSection({ credit }: { credit: CreditOverview }) {
  return (
    <Section
      title="Credit & risk control"
      subtitle="Authoritative credit positions from the shared calculator — the same arithmetic checkout uses."
      icon={Wallet}
      status={credit.status}
      actions={<LinkPill href="/admin/retailers">Retailer management</LinkPill>}
    >
      {credit.status === 'empty' ? (
        <SectionEmptyState title="No retailers yet" body="Credit positions appear as soon as retailers exist and order through the platform." />
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Card className="p-4">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-ink-400">Total credit utilized (limit set)</p>
              <p className="mt-1.5 text-base font-bold text-ink-950">{inr(credit.totalConfiguredLimit)}</p>
              <p className="text-[10px] text-ink-400">{credit.retailersWithLimit} retailer(s) with a configured limit</p>
            </Card>
            <Card className="p-4">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-ink-400">Total outstanding</p>
              <p className="mt-1.5 text-base font-bold text-ink-950">{inr(credit.totalOutstanding)}</p>
              <p className="text-[10px] text-ink-400">across all retailers</p>
            </Card>
            <Card className={`p-4 ${credit.overLimitCount > 0 ? 'border-red-200 bg-red-50/40' : ''}`}>
              <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-ink-400">
                <ShieldAlert className={`h-3.5 w-3.5 ${credit.overLimitCount > 0 ? 'text-red-500' : ''}`} /> Over limit
              </div>
              <p className={`mt-1.5 text-base font-bold ${credit.overLimitCount > 0 ? 'text-red-600' : 'text-ink-950'}`}>
                {credit.overLimitCount} retailer(s)
              </p>
              <p className="text-[10px] text-ink-400">{credit.overLimitAmount > 0 ? `${inr(credit.overLimitAmount)} above configured limits` : 'no excess'}</p>
            </Card>
            <Card className="flex items-center justify-center p-4">
              <Donut percent={credit.utilizationPct} label="utilization" />
            </Card>
          </div>

          <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
            <Card className="p-4">
              <p className="mb-3 text-xs font-semibold text-ink-700">Credit-limit utilization distribution</p>
              <ul className="space-y-2">
                {credit.buckets.map((bucket) => (
                  <li key={bucket.label} className="flex items-center justify-between text-xs">
                    <span className="text-ink-600">{bucket.label}</span>
                    <span className="font-bold text-ink-900">{bucket.count}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-3 border-t border-ink-50 pt-2 text-[10px] leading-4 text-ink-400">
                Overdue status is not displayed because the platform does not yet record payment due dates or collection history — this is
                reported honestly rather than estimated.
              </p>
            </Card>

            <Card className="p-4 lg:col-span-2">
              <p className="mb-2 text-xs font-semibold text-ink-700">Highest-risk retailers (by limit utilization)</p>
              {credit.highRisk.length === 0 ? (
                <p className="py-4 text-center text-xs text-ink-400">No credit exposure recorded.</p>
              ) : (
                <DataTable headers={['Retailer', 'Outstanding', 'Limit', 'Utilization', 'Status']} caption="Highest-risk retailers">
                  {credit.highRisk.map((row) => (
                    <tr key={row.retailerId}>
                      <Td>
                        <Link href={`/admin/retailers/${row.retailerId}`} className="font-medium text-ink-900 hover:text-primary-700">
                          {row.shopName}
                        </Link>
                      </Td>
                      <Td>{inr(row.outstanding)}</Td>
                      <Td>{row.limit > 0 ? inr(row.limit) : 'not set'}</Td>
                      <Td>
                        {row.utilizationPct === null ? (
                          <span className="text-ink-400">—</span>
                        ) : (
                          <TagPill label={`${row.utilizationPct}%`} tone={row.utilizationPct > 100 ? 'bad' : row.utilizationPct >= 80 ? 'warn' : 'default'} />
                        )}
                      </Td>
                      <Td><TagPill label={row.status} tone={row.status === 'active' ? 'good' : row.status === 'suspended' ? 'bad' : 'warn'} /></Td>
                    </tr>
                  ))}
                </DataTable>
              )}
            </Card>
          </div>

          <Card className="border-ink-100 bg-ink-50/50 p-4">
            <p className="text-xs leading-5 text-ink-600">
              <span className="font-semibold text-ink-800">Payment trend:</span> not recorded — the schema tracks outstanding balances but not
              individual collections or due dates. Once a payment workflow is added to the platform, this section will surface the collection trend
              automatically. Credit reviews themselves happen on the{' '}
              <Link href="/admin/retailers" className="font-semibold text-primary-700 hover:underline">existing retailer pages</Link>.
            </p>
          </Card>
        </div>
      )}
    </Section>
  );
}
