/** Shared status pill for GRNs / transfers / any draft-confirmed-cancelled flow. */
export function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    draft: 'bg-ink-100 text-ink-600',
    confirmed: 'bg-mint-50 text-mint-700',
    cancelled: 'bg-primary-50 text-primary-700',
    pending: 'bg-amber-50 text-amber-700',
    completed: 'bg-mint-50 text-mint-700',
  };
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${styles[status] ?? 'bg-ink-100 text-ink-600'}`}>
      {status}
    </span>
  );
}
