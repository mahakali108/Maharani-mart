import { AuthFrame } from '@/components/auth/auth-frame';
import type { Metadata } from 'next';
import { createClient } from '@/lib/supabase/server';
import { ResetPasswordForm } from '@/components/auth/reset-password-form';
import { BRAND } from '@/lib/brand';

export const metadata: Metadata = { title: `Set new password — ${BRAND.name}` };

export default async function ResetPasswordPage({
  searchParams: searchParamsPromise,
}: {
  searchParams: Promise<{ code?: string; error?: string }>;
}) {
  const searchParams = await searchParamsPromise;
  const supabase = (await createClient());
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
    <AuthFrame>
          <h1 className="shop-heading">Set new password</h1>
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
    </AuthFrame>
  );
}
