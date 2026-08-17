import type { Metadata } from 'next';
import { createClient } from '@/lib/supabase/server';
import { ResetPasswordForm } from '@/components/auth/reset-password-form';

export const metadata: Metadata = { title: 'Set new password — Maa Kali B2B' };

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: { code?: string; error?: string };
}) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // If code is present but no session yet, the user likely landed here
  // directly (redirectTo set to /reset-password). Exchange it if possible.
  // Fallback: callback route handles exchange for /auth/callback?next=/reset-password
  // so this branch is mostly for direct links.
  const hasCode = !!searchParams.code;
  const isAuthed = !!user;

  return (
    <div className="flex min-h-screen">
      <div className="relative hidden w-1/2 flex-col justify-between bg-ink-950 p-12 text-white lg:flex">
        <div className="absolute inset-0 bg-gradient-to-br from-primary-700/30 via-transparent to-transparent" />
        <div className="relative">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary-600 text-lg font-bold">MK</div>
            <span className="text-lg font-semibold">Maa Kali B2B</span>
          </div>
        </div>
        <div className="relative space-y-3">
          <h1 className="text-3xl font-semibold leading-tight">Choose a new password</h1>
          <p className="max-w-md text-ink-300">Make it at least 8 characters. You&apos;ll be signed in automatically.</p>
        </div>
      </div>

      <div className="flex w-full flex-col justify-center px-6 py-12 lg:w-1/2 lg:px-20">
        <div className="mx-auto w-full max-w-sm animate-fade-in">
          <div className="mb-8 lg:hidden">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary-600 text-white font-bold">MK</div>
              <span className="text-lg font-semibold text-ink-900">Maa Kali B2B</span>
            </div>
          </div>

          <h2 className="text-2xl font-semibold text-ink-950">Set new password</h2>
          <p className="mt-1.5 mb-8 text-sm text-ink-500">
            {isAuthed ? 'Enter your new password below.' : hasCode ? 'Verifying your link…' : 'Your reset link is invalid or has expired. Request a new one from the forgot password page.'}
          </p>

          {searchParams.error ? (
            <div className="mb-5 rounded-xl border border-primary-200 bg-primary-50 px-4 py-3 text-sm text-primary-700">
              {searchParams.error}
            </div>
          ) : null}

          {!isAuthed && !hasCode ? (
            <a
              href="/forgot-password"
              className="inline-flex w-full items-center justify-center rounded-xl bg-primary-600 px-4 py-3 text-sm font-medium text-white hover:bg-primary-700"
            >
              Request new link
            </a>
          ) : (
            <ResetPasswordForm />
          )}
        </div>
      </div>
    </div>
  );
}
