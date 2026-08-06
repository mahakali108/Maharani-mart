import type { Metadata } from 'next';
import { ShieldAlert } from 'lucide-react';
import { logoutAction } from '@/lib/auth/actions';
import { Button } from '@/components/ui/button';

export const metadata: Metadata = { title: 'Not authorized — Maa Kali B2B' };

export default function UnauthorizedPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-ink-50 px-4">
      <div className="w-full max-w-md animate-fade-in rounded-2xl border border-ink-100 bg-white p-8 text-center shadow-premium">
        <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-full bg-primary-50">
          <ShieldAlert className="h-7 w-7 text-primary-600" />
        </div>
        <h1 className="text-xl font-semibold text-ink-950">You don&apos;t have access to this page</h1>
        <p className="mt-2 text-sm text-ink-500">
          Your account role doesn&apos;t permit access to that section of the platform. If you
          think this is a mistake, contact your admin.
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
