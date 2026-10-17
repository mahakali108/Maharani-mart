import type { Metadata } from 'next';
import Link from 'next/link';
import { AuthFrame } from '@/components/auth/auth-frame';
import { SupplierApplicationForm } from '@/components/admin/supplier-application-form';

export const metadata: Metadata = { title: 'Apply to supply — Maharani Traders' };

/**
 * Public supplier application (V1, application-only). No account is created,
 * no document is uploaded here, and nothing an applicant enters is treated
 * as verified — review happens in /admin/suppliers/applications.
 */
export default function RegisterSupplierPage() {
  return (
    <AuthFrame wide>
      <h1 className="shop-heading">Apply to supply Maharani Traders</h1>
      <p className="mt-1.5 mb-8 text-sm text-ink-500">
        Tell us about your business. An admin will review your application and contact you — please do not send
        documents until our team asks for them.
      </p>
      <SupplierApplicationForm />
      <p className="mt-6 text-center text-sm text-ink-400">
        Already a retailer?{' '}
        <Link href="/register-retailer" className="font-medium text-primary-600 hover:text-primary-700">
          Register your shop instead
        </Link>
      </p>
    </AuthFrame>
  );
}
