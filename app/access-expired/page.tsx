import { Clock, Mail, ShieldAlert } from 'lucide-react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

export default async function AccessExpiredPage() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();

  let expiresAt: string | null = null;
  let role: string | null = null;

  if (user) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single();
    role = (profile as unknown as { role: string } | null)?.role ?? null;

    const { data: access } = await supabase
      .from('user_access_periods')
      .select('expires_at')
      .eq('user_id', user.id)
      .in('status', ['expired', 'active', 'expiring_soon'])
      .order('created_at', { ascending: false })
      .limit(1)
      .single();
    expiresAt = (access as unknown as { expires_at: string | null } | null)?.expires_at ?? null;
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-ink-50 px-4">
      <div className="w-full max-w-md rounded-2xl border border-ink-100 bg-white p-8 text-center shadow-card">
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-red-100">
          <ShieldAlert className="h-8 w-8 text-red-600" />
        </div>

        <h1 className="text-xl font-semibold text-ink-950">Access Expired</h1>

        <p className="mt-2 text-sm text-ink-600">
          Your access period to Maharani Traders has expired.
          {role ? ` Your role: ${role.replace('_', ' ')}.` : ''}
        </p>

        {expiresAt ? (
          <div className="mt-4 flex items-center justify-center gap-2 rounded-lg bg-ink-50 px-4 py-3">
            <Clock className="h-4 w-4 text-ink-500" />
            <span className="text-sm text-ink-700">
              Expired on {new Date(expiresAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}
            </span>
          </div>
        ) : null}

        <div className="mt-6 space-y-3">
          <div className="flex items-center justify-center gap-2 rounded-lg bg-blue-50 px-4 py-3">
            <Mail className="h-4 w-4 text-blue-600" />
            <span className="text-sm text-blue-800">
              Contact your administrator to extend your access.
            </span>
          </div>

          <p className="text-xs text-ink-400">
            Support: support@maharanitraders.com
          </p>
        </div>

        <div className="mt-6">
          <Link
            href="/login"
            className="inline-flex h-11 items-center justify-center rounded-xl bg-ink-950 px-6 text-sm font-medium text-white transition-colors hover:bg-ink-900"
          >
            Back to Login
          </Link>
        </div>
      </div>
    </div>
  );
}
