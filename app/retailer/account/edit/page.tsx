import Link from 'next/link';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { requireUser } from '@/lib/auth/session';
import { ContactDetailsForm, ShopProfileForm } from '@/components/retailer/profile-edit-forms';

interface EditProfileRow {
  shop_name: string;
  gstin: string | null;
  address: string | null;
  status: string;
}

export const metadata = { title: 'Edit profile — Maharani Traders' };

export default async function EditProfilePage() {
  const user = await requireUser();
  const supabase = createClient();

  const [{ data: retailer }, { data: profile }] = await Promise.all([
    supabase
      .from('retailers')
      .select('shop_name, gstin, address, status')
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

      <div>
        <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-primary-600">Your account</p>
        <h1 className="mt-1 text-xl font-bold tracking-tight text-slate-950 sm:text-2xl">Edit profile</h1>
        <p className="mt-1 text-xs text-slate-500">Keep your shop and contact details current for invoices and delivery.</p>
      </div>

      <ShopProfileForm
        shopName={retailer?.shop_name ?? user.fullName}
        address={retailer?.address ?? null}
        editable={false}
      />
      <ContactDetailsForm fullName={user.fullName} phone={profile?.phone ?? ''} />
    </div>
  );
}
