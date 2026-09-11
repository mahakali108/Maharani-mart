/**
 * Delivery status badge. Plain component (no hooks) — usable from both
 * server and client trees.
 */

import {
  CircleCheck,
  CircleDashed,
  CircleX,
  PackageCheck,
  PackageX,
  Truck,
} from 'lucide-react';

import type { DeliveryStatus } from '@/lib/delivery/state-machine';

const STATUS_CONFIG: Record<DeliveryStatus, { label: string; className: string; icon: typeof Truck }> = {
  assigned: { label: 'Assigned', className: 'bg-blue-50 text-blue-700', icon: CircleDashed },
  in_progress: { label: 'In progress', className: 'bg-violet-50 text-violet-700', icon: Truck },
  delivered: { label: 'Delivered', className: 'bg-green-50 text-green-700', icon: PackageCheck },
  partially_delivered: { label: 'Partially delivered', className: 'bg-amber-50 text-amber-700', icon: PackageCheck },
  failed: { label: 'Failed', className: 'bg-primary-50 text-primary-700', icon: PackageX },
  returned_to_warehouse: { label: 'Returned to warehouse', className: 'bg-ink-100 text-ink-700', icon: CircleX },
};

export function DeliveryStatusBadge({ status }: { status: string }) {
  const config = STATUS_CONFIG[status as DeliveryStatus] ?? {
    label: status,
    className: 'bg-ink-100 text-ink-700',
    icon: CircleCheck,
  };
  const Icon = config.icon;
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${config.className}`}
    >
      <Icon className="h-3.5 w-3.5" />
      {config.label}
    </span>
  );
}
