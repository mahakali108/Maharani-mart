import Link from 'next/link';
import { FileQuestion } from 'lucide-react';

export default function NotFound() {
  return (
    <div className="flex min-h-screen items-center justify-center auth-surface px-4 py-8">
      <div className="w-full max-w-md rounded-2xl border border-ink-100 bg-white p-6 sm:p-10 text-center shadow-premium">
        <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-lavender-100">
          <FileQuestion className="h-7 w-7 text-primary-600" />
        </div>
        <h1 className="shop-heading">Page not found</h1>
        <p className="mt-3 text-sm leading-6 text-ink-600">
          The page you&apos;re looking for doesn&apos;t exist or may have moved.
        </p>
        <Link href="/" className="mt-6 flex min-h-11 w-full items-center justify-center rounded-xl bg-primary-600 px-4 text-sm font-semibold text-white hover:bg-primary-700">Go home</Link>
      </div>
    </div>
  );
}
