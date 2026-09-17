import { Skeleton } from '@/components/ui/skeleton';

/**
 * Loading state for the categories list — shaped like the real page (header,
 * tabs, create card, filter card, table rows) so the layout does not jump
 * when data arrives.
 */
export default function Loading() {
  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
        <div className="space-y-2">
          <Skeleton className="h-7 w-36" />
          <Skeleton className="h-4 w-80 max-w-full" />
        </div>
        <Skeleton className="h-11 w-48 rounded-xl" />
      </div>

      <Skeleton className="h-36 rounded-2xl" />
      <Skeleton className="h-32 rounded-2xl" />

      <div className="space-y-3">
        <div className="overflow-hidden rounded-xl border border-ink-100 bg-white">
          <Skeleton className="h-10 w-full rounded-none bg-ink-50" />
          {Array.from({ length: 8 }).map((_, index) => (
            <div key={index} className="flex items-center gap-4 border-t border-ink-100 px-5 py-3.5">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-4 w-10" />
              <Skeleton className="h-4 w-14" />
              <Skeleton className="ml-auto h-6 w-40 rounded-full" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
