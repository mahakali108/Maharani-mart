import type { Metadata } from 'next';
import { LoginForm } from '@/components/auth/login-form';
import { AuthFrame } from '@/components/auth/auth-frame';
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
    <AuthFrame>
      <p className="shop-eyebrow">Welcome to your wholesale store</p>
      <h1 className="shop-heading mt-2">Welcome back</h1>
      <p className="mb-7 mt-3 text-sm leading-6 text-slate-600">Sign in to continue shopping with Maharani Traders.</p>
      <p className="mb-5 text-xs text-slate-500 lg:hidden">Based in {SERVICE_AREA_LABEL}</p>
      {searchParams.error && errorMessages[searchParams.error] ? (
        <div role="alert" className="mb-5 rounded-xl border border-primary-200 bg-primary-50 px-4 py-3 text-sm text-primary-700">{errorMessages[searchParams.error]}</div>
      ) : null}
      <LoginForm redirectTo={searchParams.redirect} />
    </AuthFrame>
  );
}
