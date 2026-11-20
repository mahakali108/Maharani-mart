import type { Metadata } from 'next';
import { Clock } from 'lucide-react';
import { logoutAction } from '@/lib/auth/actions';
import { Button } from '@/components/ui/button';
import { BRAND } from '@/lib/brand';

export const metadata: Metadata = { title: `Approval pending — ${BRAND.name}` };

export default function PendingApprovalPage() {
  return (
    <div className="flex min-h-screen items-center justify-center auth-surface px-4 py-8">
      <div className="w-full max-w-md animate-fade-in rounded-2xl border border-ink-100 bg-white p-6 sm:p-10 text-center shadow-premium">
        <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-lavender-100">
          <Clock className="h-7 w-7 text-primary-600" />
        </div>
        <h1 className="shop-heading">Your account is under review</h1>
        <p className="mt-3 text-sm leading-6 text-ink-600">
          Thanks for registering your shop with Maharani Traders. An admin needs to verify and
          approve your account before you can browse the catalog and place orders. This usually
          doesn&apos;t take long — you&apos;ll be notified once it&apos;s approved.
        </p>
        <form action={logoutAction} className="mt-6">
          <Button type="submit" variant="outline" className="w-full">
            Sign out
          </Button>
        </form>
      </div>
    </div>
  );
}
