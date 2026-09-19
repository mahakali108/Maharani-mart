export default function BrandDetailLoading() {
  return (
    <div className="space-y-5 sm:space-y-7" aria-busy="true" aria-label="Loading brand">
      <div className="h-3 w-40 animate-pulse rounded bg-slate-200" />
      <div className="h-11 w-full animate-pulse rounded-2xl bg-slate-100" />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {Array.from({ length: 8 }).map((_, index) => (
          <div key={index} className="h-52 animate-pulse rounded-2xl bg-slate-100" />
        ))}
      </div>
    </div>
  );
}
