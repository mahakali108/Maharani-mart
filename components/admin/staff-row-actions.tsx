'use client';

import Link from 'next/link';
import { Pencil } from 'lucide-react';
import { toggleStaffActiveAction } from '@/lib/admin/team-actions';
import { ToggleActiveButton } from '@/components/admin/toggle-active-button';

export function StaffRowActions({ staffId, isActive }: { staffId: string; isActive: boolean }) {
  return (
    <div className="flex items-center justify-end gap-2">
      <ToggleActiveButton isActive={isActive} onToggle={() => toggleStaffActiveAction(staffId, !isActive)} />
      <Link
        href={`/admin/team/${staffId}`}
        className="rounded-lg p-1.5 text-ink-400 hover:bg-ink-100 hover:text-ink-700"
        aria-label="Edit staff member"
      >
        <Pencil className="h-3.5 w-3.5" />
      </Link>
    </div>
  );
}
