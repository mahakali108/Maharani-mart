import Link from 'next/link';
import { Store } from 'lucide-react';

import { MarketplaceDecisionForm, PublishAgreementVersionForm } from '@/components/admin/marketplace-launch-forms';
import { Card } from '@/components/ui/card';
import { requireSuperAdminPage } from '@/lib/admin/control-center/guard';
import { getMarketplaceLaunchState } from '@/lib/admin/marketplace/queries';
import { formatIndiaDateTime } from '@/lib/datetime/india';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Marketplace launch' };

export default async function MarketplaceLaunchPage() {
  await requireSuperAdminPage();
  const state = await getMarketplaceLaunchState();
  const { agreement } = state;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold text-slate-900">
          <Store className="h-6 w-6 text-primary-600" /> Marketplace launch
        </h1>
        <p className="mt-1 max-w-3xl text-sm text-slate-600">
          Controls whether third-party sellers can put offers on sale. Maharani Traders’ own stock is not affected.
          The database enforces this switch; this screen only records the decision.
        </p>
      </div>

      {!state.available ? (
        <div role="alert" className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          The marketplace controls could not be read. They are part of database migration 0098, which may not be
          applied yet. Until they can be read, third-party seller offers are treated as <strong>disabled</strong>.
        </div>
      ) : null}

      <Card className="p-5">
        <h2 className="text-sm font-bold text-slate-900">Current status</h2>
        <p className="mt-3 flex flex-wrap items-center gap-2 text-sm text-slate-800">
          Third-party seller offers are
          <span
            className={
              state.open
                ? 'rounded-full bg-mint-100 px-3 py-1 text-xs font-bold text-mint-800'
                : 'rounded-full bg-slate-200 px-3 py-1 text-xs font-bold text-slate-800'
            }
          >
            {state.open ? 'ENABLED' : 'DISABLED'}
          </span>
        </p>
        <p className="mt-2 text-xs leading-5 text-slate-600">
          {state.open
            ? 'A seller’s offer can go live only after that seller’s owner has accepted the current Seller Agreement and the offer has been approved.'
            : 'No seller offer can be created live, activated or approved, and seller stock cannot be added to a new order. Sellers can still deactivate offers and manage stock.'}
        </p>
      </Card>

      <Card className="p-5">
        <h2 className="text-sm font-bold text-slate-900">Record a decision</h2>
        <p className="mt-1 mb-4 text-xs text-slate-600">Every decision is added to the history below and cannot be edited or deleted.</p>
        <MarketplaceDecisionForm currentlyOpen={state.open} disabled={!state.available} />
      </Card>

      <Card className="p-5">
        <h2 className="text-sm font-bold text-slate-900">Seller Agreement version</h2>
        <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-xs text-slate-500">Version shown on the public page (this build)</dt>
            <dd className="font-semibold text-slate-900">
              {agreement.buildVersion ?? '—'}{' '}
              <Link href="/legal/seller-agreement" className="text-xs font-semibold text-primary-700 underline">Read it</Link>
            </dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500">Version the database enforces</dt>
            <dd className="font-semibold text-slate-900">
              {agreement.databaseVersion ?? '—'}
              {agreement.publishedAt ? <span className="ml-2 text-xs font-normal text-slate-500">since {formatIndiaDateTime(agreement.publishedAt)}</span> : null}
            </dd>
          </div>
        </dl>
        {agreement.inSync ? (
          <p className="mt-3 text-xs text-slate-600">
            The two match. To publish a new version, the agreement text and its version number are first changed in
            the website’s legal register by a developer and deployed; the new version then appears here to be enforced.
          </p>
        ) : (
          <div className="mt-3 space-y-3">
            <p role="alert" className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-900">
              The versions differ, so seller offers are blocked for every seller until this is resolved. The Seller
              Agreement is still a draft that needs review by an advocate before it is relied on.
            </p>
            {agreement.buildVersion && state.available ? (
              <PublishAgreementVersionForm version={agreement.buildVersion} disabled={!state.available} />
            ) : null}
          </div>
        )}
      </Card>

      <Card className="p-5">
        <h2 className="text-sm font-bold text-slate-900">Approval history ({state.history.length})</h2>
        {state.history.length === 0 ? (
          <p className="mt-3 text-xs text-slate-600">No decision has been recorded. With no decision on record the marketplace is disabled.</p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-xs">
              <caption className="sr-only">Marketplace launch decisions, newest first</caption>
              <thead className="border-b border-slate-200 text-slate-500">
                <tr>
                  <th scope="col" className="py-2 pr-3 font-semibold">When</th>
                  <th scope="col" className="py-2 pr-3 font-semibold">Decision</th>
                  <th scope="col" className="py-2 pr-3 font-semibold">Owner approval reference</th>
                  <th scope="col" className="py-2 pr-3 font-semibold">CA approval reference</th>
                  <th scope="col" className="py-2 pr-3 font-semibold">Reason</th>
                  <th scope="col" className="py-2 font-semibold">Recorded by</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-800">
                {state.history.map((row) => (
                  <tr key={row.id}>
                    <td className="py-2 pr-3 whitespace-nowrap">{formatIndiaDateTime(row.recordedAt)}</td>
                    <td className="py-2 pr-3 font-semibold">{row.enabled ? 'Enabled' : 'Disabled'}</td>
                    <td className="py-2 pr-3">{row.ownerReference ?? '—'}</td>
                    <td className="py-2 pr-3">{row.caReference ?? '—'}</td>
                    <td className="py-2 pr-3">{row.reason ?? '—'}</td>
                    <td className="py-2">{row.recordedByName ?? row.recordedBy}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
