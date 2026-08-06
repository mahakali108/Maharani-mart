'use client';

import { toggleRouteActiveAction } from '@/lib/admin/routes-actions';
import { ToggleActiveButton } from '@/components/admin/toggle-active-button';

export function RouteRowActions({ id, isActive }: { id: string; isActive: boolean }) {
  return <ToggleActiveButton isActive={isActive} onToggle={() => toggleRouteActiveAction(id, !isActive)} />;
}
