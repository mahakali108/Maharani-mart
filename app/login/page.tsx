import type { Metadata } from 'next';
import { LoginForm } from '@/components/auth/login-form';

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
    <div className="flex min-h-screen">
      {/* Brand panel */}
      <div className="relative hidden w-1/2 flex-col justify-between bg-ink-950 p-12 text-white lg:flex">
        <div className="absolute inset-0 bg-gradient-to-br from-primary-700/30 via-transparent to-transparent" />
        <div className="relative">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary-600 text-lg font-bold">
              M
            </div>
            <span className="text-lg font-semibold">Maharani Traders</span>
          </div>
        </div>
        <div className="relative space-y-3">
          <h1 className="text-3xl font-semibold leading-tight">
            Smart ordering for modern Indian retailers.
          </h1>
          <p className="max-w-md text-ink-300">
            Piece-based pricing, live inventory, retailer-wise rates, and instant
            ordering — built for your shop.
          </p>
        </div>
      </div>

      {/* Form panel */}
      <div className="flex w-full flex-col justify-center px-6 py-12 lg:w-1/2 lg:px-20">
        <div className="mx-auto w-full max-w-sm animate-fade-in">
          <div className="mb-8 lg:hidden">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary-600 text-white font-bold">
                M
              </div>
              <span className="text-lg font-semibold text-ink-900">Maharani Traders</span>
            </div>
          </div>

          <h2 className="text-2xl font-semibold text-ink-950">Welcome back</h2>
          <p className="mt-1.5 mb-8 text-sm text-ink-500">Sign in to your account to continue.</p>

          {searchParams.error && errorMessages[searchParams.error] ? (
            <div className="mb-5 rounded-xl border border-primary-200 bg-primary-50 px-4 py-3 text-sm text-primary-700">
              {errorMessages[searchParams.error]}
            </div>
          ) : null}

          <LoginForm redirectTo={searchParams.redirect} />
        </div>
      </div>
    </div>
  );
}
