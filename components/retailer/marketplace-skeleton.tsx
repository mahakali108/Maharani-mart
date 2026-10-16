import { Skeleton } from '@/components/ui/skeleton';

export function MarketplaceSkeleton() {
  return (
    <div role="status" aria-label="Loading store" className="space-y-6">
      <span className="sr-only">Loading your store…</span>
      <div className="rounded-[1.75rem] border border-lavender-200 bg-lavender-50 p-6 sm:p-10">
        <Skeleton className="h-3 w-28" />
        <Skeleton className="mt-2 h-12 w-full max-w-lg" />
        <Skeleton className="mt-4 h-4 w-48" />
      </div>
      <div className="flex gap-3 overflow-hidden">
        {Array.from({ length: 6 }).map((_, index) => (
          <div key={index} className="flex w-[74px] shrink-0 flex-col items-center gap-2">
            <Skeleton className="h-14 w-14 rounded-2xl" />
            <Skeleton className="h-3 w-12" />
          </div>
        ))}
      </div>
      <Skeleton className="h-48 rounded-2xl sm:h-64" />
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <div key={index} className="space-y-2 rounded-2xl border border-slate-100 p-2">
            <Skeleton className="aspect-square rounded-xl" />
            <Skeleton className="h-3 w-16" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-5 w-20" />
            <Skeleton className="h-8 w-full" />
          </div>
        ))}
      </div>
    </div>
  );
}
