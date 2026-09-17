import { Skeleton } from '@/components/ui/skeleton';

/**
 * Loading state for the catalog section (categories & brands lists, hub and
 * edit pages) — shaped like the list pages (header, add card, filter card,
 * table rows) so the layout does not jump when data arrives.
 */
export default function Loading() {
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Skeleton className="h-7 w-40" />
        <Skeleton className="h-4 w-96 max-w-full" />
      </div>

      <Skeleton className="h-36 rounded-2xl" />

      <Skeleton className="h-32 rounded-2xl" />

      <div className="space-y-3">
        <div className="overflow-hidden rounded-xl border border-ink-100 bg-white">
          <Skeleton className="h-10 w-full rounded-none bg-ink-50" />
          {Array.from({ length: 8 }).map((_, index) => (
            <div key={index} className="flex items-center gap-4 border-t border-ink-100 px-4 py-3.5">
              <Skeleton className="h-4 flex-1" />
              <Skeleton className="hidden h-4 w-28 sm:block" />
              <Skeleton className="hidden h-4 w-16 md:block" />
              <Skeleton className="h-5 w-24 rounded-full" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
