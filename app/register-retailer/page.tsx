import type { Metadata } from 'next';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { RegisterRetailerForm } from '@/components/auth/register-retailer-form';

export const metadata: Metadata = { title: 'Register your shop — Maa Kali B2B' };

export default async function RegisterRetailerPage() {
  const supabase = createClient();
  // Areas are entered by the admin via the Admin Panel (Phase 2). This
  // reads whatever real areas currently exist — empty until configured.
  const { data: areas } = await supabase
    .from('areas')
    .select('id, name')
    .eq('is_active', true)
    .order('name');

  return (
    <div className="min-h-screen bg-ink-50 px-4 py-10 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-2xl animate-fade-in">
        <div className="mb-8 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary-600 text-white font-bold">
            MK
          </div>
          <span className="text-lg font-semibold text-ink-900">Maa Kali B2B</span>
        </div>

        <div className="rounded-2xl border border-ink-100 bg-white p-6 shadow-premium sm:p-10">
          <h1 className="text-2xl font-semibold text-ink-950">Register your shop</h1>
          <p className="mt-1.5 mb-8 text-sm text-ink-500">
            Create your retailer account. An admin will review and approve it before you can
            place orders.
          </p>

          <RegisterRetailerForm areas={areas ?? []} />
        </div>

        <p className="mt-6 text-center text-sm text-ink-400">
          Distribution staff or salesman?{' '}
          <Link href="/login" className="font-medium text-primary-600 hover:text-primary-700">
            Your account is created by an admin — sign in here.
          </Link>
        </p>
      </div>
    </div>
  );
}
