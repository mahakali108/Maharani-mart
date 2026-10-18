import type { Metadata } from 'next';
import { AuthFrame } from '@/components/auth/auth-frame';
import { RegisterSellerForm } from '@/components/auth/register-seller-form';

export const metadata: Metadata = { title: 'Register as a seller — Maharani Traders' };

export default function RegisterSellerPage() {
  return (
    <AuthFrame wide>
      <h1 className="shop-heading">Register as a Marketplace Seller</h1>
      <p className="mt-1.5 mb-8 text-sm text-ink-500">
        Create your seller account on Maharani Marketplace. Once an admin reviews and activates your
        business profile, you can publish offers, set quantity-tier prices, and fulfil sub-orders.
      </p>
      <RegisterSellerForm />
    </AuthFrame>
  );
}
