import { Skeleton } from '@/components/ui/skeleton';

/**
 * Product detail page skeleton — mirrors the real layout (gallery left,
 * info right on desktop; stacked on mobile) so the page never flashes a
 * reflow when the server resolves the product, packs and cart state.
 */
export default function Loading() {
  return (
    <div
      className="mx-auto w-full max-w-full overflow-x-hidden pb-[calc(6rem+env(safe-area-inset-bottom))] sm:space-y-5"
      aria-busy="true"
      aria-label="Loading product"
    >
      {/* Breadcrumb skeleton */}
      <div className="flex items-center gap-1.5">
        <Skeleton className="h-3.5 w-16" />
        <Skeleton className="h-3.5 w-24" />
        <Skeleton className="h-3.5 w-32" />
      </div>

      <div className="grid w-full grid-cols-1 items-start gap-4 sm:gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] lg:gap-8">
        {/* Gallery skeleton */}
        <div className="min-w-0 space-y-3">
          <Skeleton className="min-h-[360px] w-full rounded-2xl sm:min-h-[440px] lg:min-h-[520px]" />
          <div className="flex gap-2">
            <Skeleton className="h-[72px] w-[72px] rounded-xl" />
            <Skeleton className="h-[72px] w-[72px] rounded-xl" />
            <Skeleton className="h-[72px] w-[72px] rounded-xl" />
          </div>
        </div>

        {/* Info column skeleton */}
        <div className="min-w-0 space-y-4 sm:space-y-5">
          <div className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5 lg:p-6">
            <div className="flex gap-2">
              <Skeleton className="h-5 w-20 rounded-full" />
              <Skeleton className="h-5 w-24 rounded-full" />
            </div>
            <Skeleton className="mt-3 h-6 w-4/5" />
            <Skeleton className="mt-2 h-3 w-3/5" />
            <div className="mt-4 border-t border-slate-100 pt-4">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="mt-2 h-9 w-36" />
              <div className="mt-2 flex items-center gap-3">
                <Skeleton className="h-4 w-20" />
                <Skeleton className="h-4 w-14" />
              </div>
              <Skeleton className="mt-3 h-20 w-full rounded-xl" />
            </div>
            <div className="mt-4 border-t border-slate-100 pt-4">
              <Skeleton className="h-3 w-32" />
              <div className="mt-2 flex gap-1.5">
                <Skeleton className="h-6 w-20 rounded-full" />
                <Skeleton className="h-6 w-16 rounded-full" />
                <Skeleton className="h-6 w-14 rounded-full" />
              </div>
              <div className="mt-4 border-t border-slate-100 pt-4">
                <div className="flex gap-2">
                  <Skeleton className="h-11 w-28 rounded-xl" />
                  <Skeleton className="h-11 w-28 rounded-xl" />
                  <Skeleton className="h-11 w-28 rounded-xl" />
                </div>
              </div>
            </div>
          </div>

          {/* Quantity selector skeleton */}
          <div className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="mt-3 h-16 w-full rounded-2xl" />
            <Skeleton className="mt-3 h-12 w-full rounded-xl" />
          </div>

          {/* Details skeleton */}
          <div className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
            <Skeleton className="h-3.5 w-28" />
            <div className="mt-3 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
              {Array.from({ length: 4 }).map((_, index) => (
                <Skeleton key={index} className="h-14 rounded-xl" />
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
