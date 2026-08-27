import { Skeleton } from '@/components/ui/skeleton';

/**
 * Cart page skeleton. Mirrors the real cart layout (header, item cards with
 * image/text/quantity, right-hand summary) so the loading experience does not
 * cause layout jumping.
 */
export function CartSkeleton() {
  return (
    <div className="space-y-5 pb-24 sm:space-y-6 lg:pb-0">
      <Skeleton className="h-3 w-32" />
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <Skeleton className="h-3 w-24" />
          <Skeleton className="mt-2 h-8 w-52" />
          <Skeleton className="mt-2 h-4 w-40" />
        </div>
        <Skeleton className="h-9 w-40" />
      </div>

      <Skeleton className="h-12 w-full rounded-xl" />

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_360px] lg:gap-7">
        <section className="space-y-3">
          {Array.from({ length: 3 }).map((_, index) => (
            <div key={index} className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm sm:p-4">
              <div className="flex gap-3 sm:gap-4">
                <Skeleton className="h-20 w-20 shrink-0 rounded-xl sm:h-24 sm:w-24" />
                <div className="min-w-0 flex-1 space-y-2">
                  <Skeleton className="h-4 w-3/4" />
                  <Skeleton className="h-3 w-1/2" />
                  <Skeleton className="h-3 w-1/3" />
                  <Skeleton className="h-6 w-28" />
                </div>
              </div>
              <div className="mt-4 flex items-center justify-between gap-3 border-t border-slate-100 pt-4">
                <Skeleton className="h-9 w-36 rounded-xl" />
                <div className="space-y-1.5 text-right">
                  <Skeleton className="ml-auto h-3 w-16" />
                  <Skeleton className="ml-auto h-5 w-24" />
                </div>
              </div>
            </div>
          ))}
        </section>

        <aside className="hidden space-y-3 lg:block">
          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-100 bg-slate-50 px-5 py-4">
              <Skeleton className="h-4 w-28" />
            </div>
            <div className="space-y-3 p-5">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-8 w-full border-t border-dashed border-slate-200 pt-4" />
              <Skeleton className="h-12 w-full rounded-xl" />
            </div>
          </div>
          <Skeleton className="h-44 w-full rounded-2xl" />
        </aside>
      </div>
    </div>
  );
}
