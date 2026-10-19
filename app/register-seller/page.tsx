import type { Metadata } from 'next';
import Link from 'next/link';
import { MailCheck } from 'lucide-react';
import { AuthFrame } from '@/components/auth/auth-frame';

export const metadata: Metadata = { title: 'Seller access by invitation — Maharani Traders' };

export default function RegisterSellerPage() {
  return (
    <AuthFrame>
      <MailCheck className="mb-5 h-9 w-9 text-primary-600" aria-hidden="true" />
      <h1 className="shop-heading">Seller access is by invitation</h1>
      <p className="mt-4 text-sm leading-6 text-slate-600">
        Only a Maharani Traders Super Admin can create a marketplace seller account.
        There is no public seller registration. If you have been invited, use the link
        in your email to set a password. Your business remains pending until Super
        Admin verifies and activates it.
      </p>
      <div className="mt-7 flex flex-wrap gap-3 text-sm font-semibold">
        <Link href="/login" className="rounded-xl bg-primary-600 px-5 py-3 text-white hover:bg-primary-700">Seller sign in</Link>
        <Link href="/forgot-password" className="rounded-xl border border-slate-200 px-5 py-3 text-slate-800 hover:bg-slate-50">Reset password</Link>
      </div>
    </AuthFrame>
  );
}
