import Link from 'next/link';
import { requireSuperAdminPage } from '@/lib/admin/control-center/guard';
import {
  getAuthoritativeBusinessProfile,
  getAuthoritativeContactGrievance,
  getAuthoritativeMarketplaceCompliance,
} from '@/lib/admin/business-settings/server';
import { BusinessSettingsManager } from '@/components/admin/business-settings/business-settings-manager';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Business and contact details — Super Admin' };

/**
 * The single place the owner's legal identity, GST state, public contact details
 * and grievance officer are recorded. The public pages that mention contact
 * details are managed content; these settings are the authoritative record the
 * launch-readiness gate reads, so the two must be kept consistent by the operator.
 *
 * Nothing here is invented: every field starts empty and an unconfigured value is
 * reported as an internal warning, never published as a placeholder.
 */
export default async function BusinessDetailsPage() {
  await requireSuperAdminPage();
  const [business, contact, marketplace] = await Promise.all([
    getAuthoritativeBusinessProfile(),
    getAuthoritativeContactGrievance(),
    getAuthoritativeMarketplaceCompliance(),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <Link href="/admin/content" className="text-xs font-semibold text-ink-500 hover:text-ink-800">
          ← Website content
        </Link>
        <h1 className="mt-1 text-2xl font-semibold text-ink-950">Business and contact details</h1>
        <p className="mt-1 max-w-3xl text-sm text-ink-500">
          Legal entity, GST state, storefront contact details and the grievance officer. These values gate launch
          readiness; they are stored separately from page text so an approval cannot be implied by wording on a page.
        </p>
      </div>

      {business.verificationStatus !== 'verified' || !contact.isConfigured ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
          <p className="font-semibold">Internal notice — not published</p>
          <p className="mt-1">
            {business.verificationStatus !== 'verified'
              ? 'The legal entity and GST details are not marked verified. '
              : ''}
            {!contact.isConfigured
              ? 'The storefront contact and grievance details are incomplete, so launch readiness treats them as unconfirmed.'
              : ''}
          </p>
        </div>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Edit settings</CardTitle>
        </CardHeader>
        <div className="p-1">
          <BusinessSettingsManager initialBusiness={business} initialContact={contact} initialMarketplace={marketplace} />
        </div>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Where these values appear</CardTitle>
        </CardHeader>
        <ul className="space-y-2 p-1 text-sm text-ink-600">
          <li>Launch readiness and the compliance checklist (server-side gate — an unverified value blocks ordering).</li>
          <li>
            The <Link href="/contact" className="font-semibold text-primary-700 underline">Contact page</Link> and the
            grievance policy are published page text managed in{' '}
            <Link href="/admin/content" className="font-semibold text-primary-700 underline">Website content</Link>. If you
            change a phone number or address here, update the page content too.
          </li>
        </ul>
      </Card>
    </div>
  );
}
