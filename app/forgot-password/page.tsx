import type { Metadata } from 'next';
import { ForgotPasswordForm } from '@/components/auth/forgot-password-form';

export const metadata: Metadata = { title: 'Forgot password — Maa Kali B2B' };

export default function ForgotPasswordPage() {
  return (
    <div className="flex min-h-screen">
      {/* Brand panel */}
      <div className="relative hidden w-1/2 flex-col justify-between bg-ink-950 p-12 text-white lg:flex">
        <div className="absolute inset-0 bg-gradient-to-br from-primary-700/30 via-transparent to-transparent" />
        <div className="relative">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary-600 text-lg font-bold">MK</div>
            <span className="text-lg font-semibold">Maa Kali B2B</span>
          </div>
        </div>
        <div className="relative space-y-3">
          <h1 className="text-3xl font-semibold leading-tight">Reset your password</h1>
          <p className="max-w-md text-ink-300">
            Enter your registered email and we&apos;ll send you a secure link to set a new password. The link works for all roles — retailers logging in with mobile number should use their account email.
          </p>
        </div>
      </div>

      {/* Form panel */}
      <div className="flex w-full flex-col justify-center px-6 py-12 lg:w-1/2 lg:px-20">
        <div className="mx-auto w-full max-w-sm animate-fade-in">
          <div className="mb-8 lg:hidden">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary-600 text-white font-bold">MK</div>
              <span className="text-lg font-semibold text-ink-900">Maa Kali B2B</span>
            </div>
          </div>

          <h2 className="text-2xl font-semibold text-ink-950">Forgot password?</h2>
          <p className="mt-1.5 mb-8 text-sm text-ink-500">No worries — we&apos;ll send you reset instructions.</p>

          <ForgotPasswordForm />
        </div>
      </div>
    </div>
  );
}
