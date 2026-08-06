import type { LucideIcon } from 'lucide-react';

export function AdminEmptyState({
  icon: Icon,
  title,
  body,
}: {
  icon: LucideIcon;
  title: string;
  body: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-ink-200 py-16 text-center">
      <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-ink-50">
        <Icon className="h-6 w-6 text-ink-400" />
      </div>
      <h3 className="text-sm font-semibold text-ink-800">{title}</h3>
      <p className="mt-1 max-w-sm text-sm text-ink-500">{body}</p>
    </div>
  );
}
