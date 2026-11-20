import { AuthFrame } from '@/components/auth/auth-frame';
import type { Metadata } from 'next';
import { ForgotPasswordForm } from '@/components/auth/forgot-password-form';
import { BRAND } from '@/lib/brand';

export const metadata: Metadata = { title: `Forgot password — ${BRAND.name}` };

export default function ForgotPasswordPage() {
  return (
    <AuthFrame>
      <p className="shop-eyebrow">Account recovery</p>
      <h1 className="shop-heading mt-2">Forgot password?</h1>
      <p className="mb-7 mt-3 text-sm leading-6 text-slate-600">Enter your registered email and we will send a secure reset link. If you usually sign in with a mobile number, use the email linked to your account.</p>
      <ForgotPasswordForm />
    </AuthFrame>
  );
}
