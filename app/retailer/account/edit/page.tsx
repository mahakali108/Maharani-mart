import { serviceAreaLabel } from '@/lib/areas/district';
import Link from 'next/link';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { requireUser } from '@/lib/auth/session';
import { ContactDetailsForm, ShopProfileForm } from '@/components/retailer/profile-edit-forms';
import { BRAND } from '@/lib/brand';

interface EditProfileRow {
  shop_name: string;
  gstin: string | null;
  address: string | null;
  status: string;
  areas: { name: string; district: string } | null;
}

export const metadata = { title: `Edit profile — ${BRAND.name}` };

export default async function EditProfilePage() {
  const user = await requireUser();
  const supabase = (await createClient());

  const [{ data: retailer }, { data: profile }] = await Promise.all([
    supabase
      .from('retailers')
      .select('shop_name, gstin, address, status, areas ( name, district )')
      .eq('id', user.id)
      .maybeSingle<EditProfileRow | never>(),
    supabase.from('profiles').select('phone').eq('id', user.id).maybeSingle<{ phone: string } | never>(),
  ]);

  return (
    <div className="mx-auto w-full max-w-2xl space-y-5">
      <nav aria-label="Breadcrumb" className="flex items-center gap-1 text-[10px] font-semibold text-slate-500 sm:text-xs">
        <Link href="/retailer/account" className="flex items-center gap-1 rounded px-1 py-0.5 hover:text-primary-600">
          <ChevronLeft className="h-3.5 w-3.5" /> Account
        </Link>
        <ChevronRight className="h-3 w-3" />
        <span className="truncate text-slate-800">Edit profile</span>
      </nav>

      <div className="shop-intro">
          <p className="shop-eyebrow">Your account</p>
        <h1 className="shop-heading mt-1 font-semibold tracking-tight text-slate-950">Edit profile</h1>
        <p className="mt-1 text-xs text-slate-500">Keep your shop and contact details current for invoices and delivery.</p>
      </div>

      <section className="rounded-2xl border border-sky-200 bg-sky-50 p-5">
        <h2 className="text-sm font-semibold text-slate-900">Verified service district &amp; area</h2>
        <p className="mt-2 break-words text-sm text-sky-700">{retailer?.areas ? serviceAreaLabel(retailer.areas) : 'Assignment unavailable'}</p>
        <p className="mt-2 text-xs leading-5 text-slate-600">Your distributor manages this assignment. To correct it, <Link href="/retailer/support/new" className="font-medium underline">contact support</Link>. Delivery addresses can be edited separately in your address book.</p>
      </section>
      <ShopProfileForm
        shopName={retailer?.shop_name ?? user.fullName}
        address={retailer?.address ?? null}
        editable={false}
      />
      <ContactDetailsForm fullName={user.fullName} phone={profile?.phone ?? ''} />
    </div>
  );
}
