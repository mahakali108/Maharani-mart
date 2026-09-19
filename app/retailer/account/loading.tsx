export default function AccountLoading() {
  return (
    <div className="space-y-5 sm:space-y-7" aria-busy="true" aria-label="Loading your account">
      <div className="h-3 w-32 animate-pulse rounded bg-slate-200" />
      <div className="h-40 w-full animate-pulse rounded-2xl bg-slate-100" />
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-4">
          <div className="h-56 w-full animate-pulse rounded-2xl bg-slate-100" />
          <div className="grid gap-2.5 sm:grid-cols-2">
            {Array.from({ length: 8 }).map((_, index) => (
              <div key={index} className="h-16 animate-pulse rounded-2xl bg-slate-100" />
            ))}
          </div>
        </div>
        <div className="h-64 w-full animate-pulse rounded-2xl bg-slate-100" />
      </div>
    </div>
  );
}
