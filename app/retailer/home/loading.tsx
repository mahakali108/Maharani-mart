import { Skeleton } from '@/components/ui/skeleton';

/** Mirrors the welcome, search, categories and two-column mobile product grid. */
export default function Loading() {
  return <div aria-busy="true" aria-label="Loading your wholesale store" className="min-w-0 space-y-6">
    <div className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4 sm:p-6">
      <Skeleton className="h-3 w-32" /><Skeleton className="h-7 w-3/4 max-w-sm" /><Skeleton className="h-4 w-full max-w-md" />
      <Skeleton className="h-14 w-full rounded-xl" />
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">{Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-24 w-full rounded-xl" />)}</div>
    </div>
    <div className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
      <Skeleton className="h-6 w-40" />
      <div className="grid grid-cols-3 gap-2.5 sm:grid-cols-5 lg:grid-cols-10">{Array.from({ length: 10 }, (_, i) => <div key={i} className="min-w-0 space-y-2"><Skeleton className="aspect-square w-full rounded-xl" /><Skeleton className="h-3 w-3/4" /></div>)}</div>
    </div>
    <Skeleton className="h-6 w-44" />
    <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4">{Array.from({ length: 8 }, (_, i) => <div key={i} className="min-w-0 space-y-3 rounded-2xl border border-slate-200 bg-white p-3"><Skeleton className="aspect-square w-full rounded-xl" /><Skeleton className="h-3 w-1/2" /><Skeleton className="h-9 w-full" /><Skeleton className="h-6 w-3/4" /><Skeleton className="h-11 w-full rounded-lg" /><Skeleton className="h-10 w-full rounded-lg" /></div>)}</div>
  </div>;
}
