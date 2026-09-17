import { Skeleton } from '@/components/ui/skeleton';

/**
 * Loading state for the product list — shaped like the real page (header,
 * filter card, table rows) so the layout does not jump when data arrives.
 */
export default function Loading() {
  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
        <div className="space-y-2">
          <Skeleton className="h-7 w-40" />
          <Skeleton className="h-4 w-96 max-w-full" />
        </div>
        <div className="flex gap-2">
          <Skeleton className="h-10 w-28 rounded-xl" />
          <Skeleton className="h-10 w-28 rounded-xl" />
          <Skeleton className="h-10 w-32 rounded-xl" />
        </div>
      </div>

      <Skeleton className="h-44 rounded-2xl" />

      <div className="space-y-3">
        <Skeleton className="h-14 rounded-xl" />
        <div className="overflow-hidden rounded-xl border border-ink-100 bg-white">
          <Skeleton className="h-10 w-full rounded-none bg-ink-50" />
          {Array.from({ length: 10 }).map((_, index) => (
            <div key={index} className="flex items-center gap-4 border-t border-ink-100 px-4 py-3.5">
              <Skeleton className="h-4 w-4 shrink-0 rounded" />
              <Skeleton className="h-4 flex-1" />
              <Skeleton className="h-4 w-20" />
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-4 w-16" />
              <Skeleton className="h-5 w-16 rounded-full" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
