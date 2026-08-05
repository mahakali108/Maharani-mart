import Link from 'next/link';
import { FileQuestion } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function NotFound() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-ink-50 px-4">
      <div className="w-full max-w-md rounded-2xl border border-ink-100 bg-white p-8 text-center shadow-premium">
        <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-full bg-primary-50">
          <FileQuestion className="h-7 w-7 text-primary-600" />
        </div>
        <h1 className="text-xl font-semibold text-ink-950">Page not found</h1>
        <p className="mt-2 text-sm text-ink-500">
          The page you&apos;re looking for doesn&apos;t exist or may have moved.
        </p>
        <Link href="/">
          <Button className="mt-6 w-full">Go home</Button>
        </Link>
      </div>
    </div>
  );
}
