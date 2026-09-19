export function CouponPageSkeleton() {
  return (
    <div className="space-y-6 sm:space-y-7" aria-busy="true" aria-label="Loading coupons">
      <div className="space-y-2">
        <div className="h-3 w-24 animate-pulse rounded bg-slate-200" />
        <div className="h-6 w-44 animate-pulse rounded bg-slate-200" />
        <div className="h-3 w-64 animate-pulse rounded bg-slate-100" />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {[0, 1, 2, 3].map((key) => (
          <div key={key} className="h-44 animate-pulse rounded-2xl border border-slate-200 bg-white p-4">
            <div className="h-10 w-2/3 rounded-lg bg-slate-100" />
            <div className="mt-4 h-3 w-1/2 rounded bg-slate-100" />
            <div className="mt-2 h-3 w-1/3 rounded bg-slate-100" />
            <div className="mt-6 h-11 w-full rounded-xl bg-slate-200" />
          </div>
        ))}
      </div>
    </div>
  );
}
