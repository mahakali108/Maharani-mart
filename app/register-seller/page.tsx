import type { Metadata } from 'next';
import Link from 'next/link';
import { AuthFrame } from '@/components/auth/auth-frame';
import { Button } from '@/components/ui/button';

export const metadata: Metadata = { title: 'Seller access — Maharani Traders' };

export default function RegisterSellerPage() {
  return (
    <AuthFrame>
      <h1 className="shop-heading">Seller accounts are invite-only</h1>
      <p className="mb-7 mt-3 text-sm leading-6 text-ink-600">
        A Maharani Traders Super Admin must create and invite each seller. If you already received an invitation,
        use its secure link to set up your password and then sign in.
      </p>
      <Link href="/login"><Button className="w-full">Go to sign in</Button></Link>
    </AuthFrame>
  );
}
