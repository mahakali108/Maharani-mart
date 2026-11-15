import { Scale, ShieldAlert } from 'lucide-react';
import { redirect } from 'next/navigation';
import { requireUser } from '@/lib/auth/session';
import {
  getAuthoritativeBusinessProfile,
  getAuthoritativeContactGrievance,
  getAuthoritativeMarketplaceCompliance,
  getAuthoritativeOrderingLaunchReadiness,
} from '@/lib/admin/business-settings/server';
import { getSuperAdminAuditLogs } from '@/lib/admin/control-center/actions';
import { ORDERING_READINESS_CATEGORY_KEYS, type OrderingReadinessCategoryKey } from '@/lib/admin/business-settings/types';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import {
  COMPLIANCE_CHECKLIST,
  COMPLIANCE_STATUS_LABELS,
  complianceSummary,
  type ComplianceStatus,
} from '@/lib/compliance/checklist';
import { serverRequestTimeMs } from '@/lib/datetime/request-time';

export const dynamic = 'force-dynamic';

const STATUS_STYLES: Record<ComplianceStatus, string> = {
  verified_in_platform: 'border-mint-200 bg-mint-50 text-mint-800',
  owner_input_required: 'border-amber-200 bg-amber-50 text-amber-900',
  ca_review_required: 'border-primary-200 bg-primary-50 text-primary-800',
  legal_review_required: 'border-warning-200 bg-warning-50 text-warning-800',
  not_applicable: 'border-ink-200 bg-ink-50 text-ink-700',
};

/**
 * India legal-readiness view.
 *
 * This page shows (a) the checklist status for each area and (b) the ACTUAL
 * values currently stored for the owner-configurable fields, so an unset
 * field reads "Owner Input Required" instead of a fabricated GSTIN, address,
 * officer name or phone number.
 *
 * It does not claim compliance. Official sources are linked for verification
 * of current text, amendments and commencement dates.
 */
export default async function CompliancePage() {
  // This view exposes owner-entered identity/contact readiness and must not be
  // available to the broader admin/reporting role. The route middleware is
  // intentionally not the only authorization boundary.
  const viewer = await requireUser();
  if (viewer.role !== 'super_admin') {
    redirect('/unauthorized');
  }

  const [business, contact, marketplace, orderingReadiness, auditLogs] = await Promise.all([
    getAuthoritativeBusinessProfile(),
    getAuthoritativeContactGrievance(),
    getAuthoritativeMarketplaceCompliance(),
    getAuthoritativeOrderingLaunchReadiness(),
    getSuperAdminAuditLogs(100),
  ]);

  const summary = complianceSummary(COMPLIANCE_CHECKLIST);
  const readinessAuditEvents = auditLogs.filter((entry) => {
    const after = entry.after_data;
    return entry.action === 'SETTING_CHANGED'
      && typeof after === 'object'
      && after !== null
      && after.schemaVersion === 1
      && typeof after.recordedAt === 'string'
      && typeof after.recordedBy === 'string';
  });
  const readinessLabels: Record<OrderingReadinessCategoryKey, string> = {
    businessIdentity: 'Business identity',
    publicContacts: 'Public contacts and grievance particulars',
    legalPolicies: 'Legal policies',
    gstInvoice: 'Invoice issuer and GST treatment',
    marketplaceTaxTcsSettlement: 'Marketplace/TCS/settlement',
    deliveryCodCancellationsRefunds: 'Delivery, COD, cancellation and refunds',
    privacyReadiness: 'Privacy governance',
  };
  const readinessReviewer = orderingReadiness
    ? readinessAuditEvents.find((entry) => entry.after_data?.recordedAt === orderingReadiness.recordedAt)
    : undefined;
  const readinessExpired = orderingReadiness
    ? Date.parse(orderingReadiness.approvalValidityPolicy.validUntil) <= serverRequestTimeMs()
    : false;

  const ownerFields = [
    { label: 'Legal entity name', value: business.legalEntityName, confirmed: business.verificationStatus === 'verified' },
    { label: 'GSTIN', value: business.gstin, confirmed: Boolean(business.gstin) && business.verificationStatus === 'verified' },
    { label: 'PAN', value: business.pan, confirmed: Boolean(business.pan) && business.verificationStatus === 'verified' },
    { label: 'Registered address', value: business.registeredAddress, confirmed: business.verificationStatus === 'verified' },
    { label: 'Support phone', value: contact.officialPhone, confirmed: contact.isConfigured },
    { label: 'Support email', value: contact.supportEmail, confirmed: contact.isConfigured },
    { label: 'Grievance officer', value: contact.grievanceOfficerName, confirmed: contact.isConfigured },
    { label: 'Grievance email', value: contact.grievanceEmail, confirmed: contact.isConfigured },
    { label: 'Grievance address', value: contact.grievanceAddress, confirmed: contact.isConfigured },
  ];

  return (
    <div className="space-y-6">
      <header>
        <div className="flex items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-ink-950">
            <Scale className="h-5 w-5 text-white" />
          </span>
          <h1 className="text-xl font-semibold text-ink-950 sm:text-2xl">India Compliance Readiness</h1>
        </div>
        <p className="mt-1 flex items-center gap-1.5 text-xs text-ink-500">
          <ShieldAlert className="h-3.5 w-3.5 text-amber-600" />
          Configuration readiness only — not a legal opinion, and not a claim that the business is compliant
        </p>
      </header>

      <Card className="border-amber-200 bg-amber-50/60">
        <p className="text-xs text-amber-900">
          This view reports which details are configured, which are missing and which need a CA or lawyer. Legal
          applicability, current amendments and commencement dates must be verified against the official sources linked
          on each item (and by the owner&apos;s professional advisers). The platform does not invent a GSTIN, address,
          officer name, phone number, licence or verification result.
        </p>
      </Card>

      <section className="space-y-3">
        <div>
          <h2 className="text-lg font-medium text-ink-900">New-order launch readiness</h2>
          <p className="mt-1 text-xs text-ink-500">
            This is the authoritative, fail-closed record consulted before a new order is created. A value is not approved merely because a setting or document field is filled.
          </p>
        </div>
        {orderingReadiness ? (
          <Card className="space-y-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-ink-900">Recorded readiness approvals</p>
                <p className="mt-1 text-xs text-ink-600">
                  Recorded {new Date(orderingReadiness.recordedAt).toLocaleString()} by {readinessReviewer?.actor_name ?? 'Super Admin'}.
                </p>
              </div>
              <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${readinessExpired ? 'border-amber-200 bg-amber-50 text-amber-900' : 'border-primary-200 bg-primary-50 text-primary-800'}`}>
                {readinessExpired ? 'Expired — blocks new orders' : 'Expires'} {new Date(orderingReadiness.approvalValidityPolicy.validUntil).toLocaleString()}
              </span>
            </div>
            <div className="table-scroll overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-ink-100 text-left text-[11px] uppercase tracking-wide text-ink-500">
                  <tr><th className="px-2 py-2 font-medium">Readiness area</th><th className="px-2 py-2 font-medium">Authoritative status</th><th className="px-2 py-2 font-medium">Approval/evidence reference</th></tr>
                </thead>
                <tbody className="divide-y divide-ink-100">
                  {ORDERING_READINESS_CATEGORY_KEYS.map((key) => {
                    const category = orderingReadiness[key];
                    return (
                      <tr key={key}>
                        <td className="px-2 py-2 text-xs font-medium text-ink-800">{readinessLabels[key]}</td>
                        <td className="px-2 py-2 text-xs text-ink-700">{category.status === 'approved' ? 'Approved' : 'Pending — blocks new orders'}</td>
                        <td className="px-2 py-2 font-mono text-xs text-ink-600">{category.status === 'approved' ? category.approvalReference : '—'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <dl className="grid gap-3 border-t border-ink-100 pt-3 text-xs sm:grid-cols-3">
              <div><dt className="font-medium text-ink-500">Recorded by</dt><dd className="mt-0.5 font-mono text-ink-800">{orderingReadiness.recordedBy}</dd></div>
              <div><dt className="font-medium text-ink-500">Validity-policy reference</dt><dd className="mt-0.5 font-mono text-ink-800">{orderingReadiness.approvalValidityPolicy.approvalReference}</dd></div>
              <div><dt className="font-medium text-ink-500">Recorded UTC</dt><dd className="mt-0.5 font-mono text-ink-800">{orderingReadiness.recordedAt}</dd></div>
            </dl>
          </Card>
        ) : (
          <Card className="border-amber-200 bg-amber-50/60">
            <p className="text-sm font-semibold text-amber-950">No valid launch-readiness record is available.</p>
            <p className="mt-1 text-xs text-amber-900">New-order creation remains blocked. Only the audited Super Admin writer can record a complete approval set with an explicit future expiry.</p>
          </Card>
        )}
        <Card>
          <p className="text-sm font-semibold text-ink-900">Readiness audit history</p>
          {readinessAuditEvents.length > 0 ? (
            <ul className="mt-2 space-y-2 text-xs text-ink-700">
              {readinessAuditEvents.slice(0, 10).map((entry) => (
                <li key={entry.id} className="rounded-lg border border-ink-100 px-3 py-2">
                  <span className="font-medium text-ink-900">{entry.actor_name}</span> recorded readiness at {new Date(entry.created_at).toLocaleString()}. {entry.reason ? `Reason: ${entry.reason}` : 'No reason recorded.'}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-1 text-xs text-ink-600">No matching readiness audit event is available. This is not evidence of approval.</p>
          )}
        </Card>
      </section>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {(Object.keys(summary) as ComplianceStatus[]).map((status) => (
          <Card key={status}>
            <p className="text-[11px] font-medium uppercase tracking-wide text-ink-500">
              {COMPLIANCE_STATUS_LABELS[status]}
            </p>
            <p className="mt-1 text-2xl font-semibold text-ink-950">{summary[status]}</p>
          </Card>
        ))}
      </div>

      <section className="space-y-3">
        <h2 className="text-lg font-medium text-ink-900">Owner-configurable details (live values)</h2>
        <Card className="table-scroll p-0">
          <table className="w-full text-sm">
            <thead className="border-b border-ink-100 bg-ink-50 text-left text-[11px] uppercase tracking-wide text-ink-500">
              <tr>
                <th className="px-3 py-2 font-medium">Field</th>
                <th className="px-3 py-2 font-medium">Current value</th>
                <th className="px-3 py-2 font-medium">State</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-100">
              {ownerFields.map((field) => (
                <tr key={field.label}>
                  <td className="px-3 py-2 text-xs font-medium text-ink-800">{field.label}</td>
                  <td className="px-3 py-2 text-xs text-ink-700">
                    {field.value && String(field.value).trim().length > 0 ? String(field.value) : '—'}
                  </td>
                  <td className="px-3 py-2">
                    <span
                      className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${
                        field.confirmed ? STATUS_STYLES.verified_in_platform : STATUS_STYLES.owner_input_required
                      }`}
                    >
                      {field.confirmed ? 'Confirmed' : 'Owner Input Required'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
        <p className="text-[11px] text-ink-500">
          Values above are the authoritative settings; edits are made in the Super Admin Control Center. A field being
          filled in does not by itself mean it was government-verified.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-medium text-ink-900">Checklist</h2>
        {COMPLIANCE_CHECKLIST.map((item) => (
          <Card key={item.id}>
            <CardHeader className="pb-2">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="text-[11px] font-medium uppercase tracking-wide text-ink-400">{item.area}</p>
                  <CardTitle className="mt-0.5 text-base">{item.requirement}</CardTitle>
                </div>
                <span className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${STATUS_STYLES[item.status]}`}>
                  {COMPLIANCE_STATUS_LABELS[item.status]}
                </span>
              </div>
            </CardHeader>
            <div className="space-y-2 text-xs text-ink-600">
              <p>
                <span className="font-semibold text-ink-800">Platform today: </span>
                {item.platformState}
              </p>
              {item.ownerInput ? (
                <p>
                  <span className="font-semibold text-ink-800">Owner input needed: </span>
                  {item.ownerInput}
                </p>
              ) : null}
              {item.notes ? (
                <p>
                  <span className="font-semibold text-ink-800">Note: </span>
                  {item.notes}
                </p>
              ) : null}
              {item.sources.length > 0 ? (
                <p className="flex flex-wrap gap-x-3 gap-y-1">
                  <span className="font-semibold text-ink-800">Official source to verify: </span>
                  {item.sources.map((source) => (
                    <a
                      key={source.url}
                      href={source.url}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="text-primary-700 underline-offset-2 hover:underline"
                    >
                      {source.label}
                    </a>
                  ))}
                </p>
              ) : null}
            </div>
          </Card>
        ))}
      </section>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Discount &amp; settlement safeguards in force</CardTitle>
        </CardHeader>
        <ul className="list-disc space-y-1 pl-5 text-xs text-ink-600">
          <li>Membership-based checkout discounts: removed (no membership discount is applied at checkout).</li>
          <li>Seller-funded discounts allowed: {marketplace.sellerFundedDiscountsAllowed ? 'configured true' : 'disabled'}.</li>
          <li>Platform-funded discounts allowed: {marketplace.platformFundedDiscountsAllowed ? 'configured true' : 'disabled'}.</li>
          <li>
            CA reference on file: {marketplace.caApprovalDocumentReference ? 'reference recorded' : 'none recorded'}.
            A filled reference field is a project control, not proof of a written opinion applying to this business.
          </li>
          <li>TCS percentage setting: {marketplace.tcsDeductionPercent}% (configuration only — not deducted today).</li>
        </ul>
      </Card>
    </div>
  );
}
