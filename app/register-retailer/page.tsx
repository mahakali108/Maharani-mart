import { AuthFrame } from '@/components/auth/auth-frame';
import type { Metadata } from 'next';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { RegisterRetailerForm } from '@/components/auth/register-retailer-form';
import { SERVICE_AREA_LABEL } from '@/lib/config/service-area';
import { BRAND } from '@/lib/brand';

export const metadata: Metadata = { title: `Register your shop — ${BRAND.name}` };

export default async function RegisterRetailerPage() {
  const supabase = (await createClient());
  // Areas are entered by the admin via the Admin Panel (Phase 2). This
  // reads whatever real areas currently exist — empty until configured.
  const { data: areas, error: areasError } = await supabase
    .from('areas')
    .select('id, name, district')
    .eq('is_active', true)
    .order('name');

  return (
    <AuthFrame wide>
          <h1 className="shop-heading">Register your shop</h1>
          <p className="mt-1.5 mb-8 text-sm text-ink-500">
            Create your retailer account. An admin will review and approve it before you can
            place orders. Initial district default (not a coverage promise): <span className="font-medium text-ink-700">{SERVICE_AREA_LABEL}</span>. Choose from the currently configured areas below. Delivery is available only for verified PINs at checkout.
          </p>

          {areasError ? <p role="alert" className="mb-4 rounded-xl bg-peach-50 p-3 text-sm text-peach-700">The service-area directory could not be loaded. Refresh to try again before registering.</p> : null}
          <RegisterRetailerForm areasUnavailable={!!areasError} areas={areas ?? []} />

        <p className="mt-6 text-center text-sm text-ink-400">
          Distribution staff or salesman?{' '}
          <Link href="/login" className="font-medium text-primary-600 hover:text-primary-700">
            Your account is created by an admin — sign in here.
          </Link>
        </p>
    </AuthFrame>
  );
}
