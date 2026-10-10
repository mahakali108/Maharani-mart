import type { Metadata } from 'next';
import { LoginForm } from '@/components/auth/login-form';
import { SERVICE_AREA_LABEL } from '@/lib/config/service-area';

export const metadata: Metadata = { title: 'Sign in — Maharani Traders' };

export default function LoginPage({
  searchParams,
}: {
  searchParams: { redirect?: string; error?: string };
}) {
  const errorMessages: Record<string, string> = {
    account_inactive: 'Your account has been deactivated. Contact your distributor.',
    account_suspended: 'Your retailer account is suspended. Contact your distributor.',
  };

  return (
    <div className="flex min-h-screen bg-ivory-100">
      {/* Brand panel — solid wine with a restrained gold rule (no gradients) */}
      <aside className="relative hidden w-1/2 flex-col justify-between overflow-hidden bg-primary-700 p-12 text-white lg:flex">
        <div className="relative">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-gold-300/60 bg-white/10 text-lg font-bold text-gold-200">
              MT
            </div>
            <span className="text-lg font-semibold tracking-tight">Maharani Traders</span>
          </div>
        </div>
        <div className="relative space-y-4">
          <span aria-hidden="true" className="block h-px w-16 bg-gold-300" />
          <h1 className="text-3xl font-semibold leading-tight tracking-tight">
            The FMCG distribution backbone for retailers in {SERVICE_AREA_LABEL}.
          </h1>
          <p className="max-w-md text-sm leading-6 text-blush-200">
            Wholesale pricing per piece, pack size and MOQ on every product, live stock status,
            and reorders from your history — in one place.
          </p>
        </div>
        <p className="relative text-xs text-blush-300">Pieces, pack sizes and stock are shown exactly as recorded by the distributor.</p>
      </aside>

      {/* Form panel */}
      <div className="flex w-full flex-col justify-center px-6 py-12 lg:w-1/2 lg:px-20">
        <div className="mx-auto w-full max-w-sm animate-fade-in">
          <div className="mb-8 lg:hidden">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary-600 font-bold text-white shadow-sm">
                MT
              </div>
              <div className="leading-tight">
                <span className="block text-lg font-semibold text-ink-950">Maharani Traders</span>
                <span className="block text-xs text-ink-500">{SERVICE_AREA_LABEL}</span>
              </div>
            </div>
          </div>

          <h2 className="text-2xl font-semibold tracking-tight text-ink-950">Welcome back</h2>
          <p className="mt-1.5 mb-8 text-sm text-ink-500">Sign in to your account to continue.</p>

          {searchParams.error && errorMessages[searchParams.error] ? (
            <div role="alert" className="mb-5 rounded-xl border border-primary-200 bg-primary-50 px-4 py-3 text-sm text-primary-700">
              {errorMessages[searchParams.error]}
            </div>
          ) : null}

          <LoginForm redirectTo={searchParams.redirect} />
        </div>
      </div>
    </div>
  );
}
