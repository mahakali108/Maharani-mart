import { AlertTriangle, Warehouse } from 'lucide-react';

/**
 * Read-only replacement for a warehouse picker.
 *
 * Maharani Traders operates ONE active warehouse, so no screen asks which one
 * to use: the server resolves it (lib/warehouse/resolver.ts) and this field
 * simply reports which warehouse the operation will be written against — or
 * shows the configuration error that blocks the operation.
 */
export function WarehouseStatusField({
  label = 'Warehouse',
  warehouse,
  error,
}: {
  label?: string;
  warehouse: { name: string } | null;
  error?: string | null;
}) {
  if (!warehouse) {
    return (
      <div>
        <p className="text-sm font-medium text-ink-700">{label}</p>
        <p className="mt-1 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-900">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span>{error ?? 'No active warehouse is configured. Set one up in Admin → Warehouses.'}</span>
        </p>
      </div>
    );
  }

  return (
    <div>
      <p className="text-sm font-medium text-ink-700">{label}</p>
      <p className="mt-1 flex items-center gap-2 rounded-xl border border-ink-100 bg-ink-50 px-3 py-2 text-sm font-semibold text-ink-900">
        <Warehouse className="h-3.5 w-3.5 text-ink-500" aria-hidden="true" />
        {warehouse.name}
      </p>
      <p className="mt-1 text-[11px] text-ink-400">The single active warehouse — assigned automatically.</p>
    </div>
  );
}
