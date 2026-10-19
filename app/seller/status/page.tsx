import Link from 'next/link';
import { Clock3, ShieldAlert } from 'lucide-react';
import { requireSellerPage } from '@/lib/seller/guard';
import { logoutAction } from '@/lib/auth/actions';
import { Button } from '@/components/ui/button';

export const dynamic = 'force-dynamic';

export default async function SellerStatusPage() {
  const { seller } = await requireSellerPage({ allowInactive: true });
  const pending = seller.status === 'pending';
  return (
    <section className="mx-auto max-w-xl rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-9">
      {pending ? <Clock3 className="h-8 w-8 text-primary-600" aria-hidden="true" /> :
        <ShieldAlert className="h-8 w-8 text-amber-700" aria-hidden="true" />}
      <h1 className="mt-4 text-2xl font-semibold text-slate-950">
        {pending ? 'Seller approval pending' : seller.status === 'suspended' ? 'Seller account suspended' : 'Seller application not approved'}
      </h1>
      <p className="mt-3 text-sm leading-6 text-slate-700">
        {pending
          ? 'Your account exists, but only Super Admin can verify and activate your business. Offers, inventory and seller orders are unavailable until then.'
          : 'Seller portal operations are unavailable while this business is not active. Existing order records are retained for administrator review.'}
      </p>
      {seller.status === 'rejected' && seller.rejection_reason ? <p className="mt-3 rounded-lg bg-slate-50 p-3 text-sm text-slate-800">Reason: {seller.rejection_reason}</p> : null}
      {seller.status === 'suspended' && seller.suspension_reason ? <p className="mt-3 rounded-lg bg-slate-50 p-3 text-sm text-slate-800">Reason: {seller.suspension_reason}</p> : null}
      <p className="mt-4 text-xs leading-5 text-slate-600">If you believe this is an error, contact your Maharani Traders administrator through a verified channel. Password reset does not change approval status.</p>
      <div className="mt-6 flex flex-wrap gap-3">
        <form action={logoutAction}><Button type="submit" variant="outline">Sign out securely</Button></form>
        <Link href="/forgot-password" className="inline-flex min-h-11 items-center text-sm font-semibold text-primary-700 underline">Reset password</Link>
      </div>
    </section>
  );
}
