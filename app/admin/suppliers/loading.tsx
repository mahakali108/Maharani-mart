export default function SuppliersLoading() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Loading suppliers">
      <div className="h-8 w-56 animate-pulse rounded-lg bg-ink-100" />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-24 animate-pulse rounded-2xl bg-ink-100" />
        ))}
      </div>
      <div className="h-64 animate-pulse rounded-2xl bg-ink-100" />
    </div>
  );
}
