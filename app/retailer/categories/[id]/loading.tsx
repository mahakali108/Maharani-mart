export default function CategoryDetailLoading() {
  return (
    <div className="space-y-5 sm:space-y-7" aria-busy="true" aria-label="Loading category">
      <div className="h-3 w-40 animate-pulse rounded bg-slate-200" />
      <div className="h-11 w-full animate-pulse rounded-2xl bg-slate-100" />
      <div className="h-64 w-full animate-pulse rounded-2xl bg-slate-100" />
      <div className="h-48 w-full animate-pulse rounded-2xl bg-slate-100" />
    </div>
  );
}
