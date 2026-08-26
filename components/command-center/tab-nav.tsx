'use client';

import Link from 'next/link';
import { cn } from '@/lib/utils/cn';
import type { CommandCenterTab } from '@/lib/admin/command-center/types';

const TABS: { id: CommandCenterTab; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'sales', label: 'Sales' },
  { id: 'inventory', label: 'Inventory' },
  { id: 'credit', label: 'Credit & Risk' },
  { id: 'retailers', label: 'Retailers' },
  { id: 'salesmen', label: 'Salesmen' },
  { id: 'suppliers', label: 'Suppliers' },
  { id: 'security', label: 'Security & Audit' },
  { id: 'copilot', label: 'AI Copilot' },
];

export function CommandCenterTabNav({ active, urgentCount }: { active: CommandCenterTab; urgentCount: number }) {
  return (
    <nav aria-label="Command Center sections" className="-mx-1 overflow-x-auto px-1">
      <div className="flex w-max gap-1 rounded-xl border border-ink-100 bg-white p-1 shadow-sm">
        {TABS.map((tab) => {
          const isActive = tab.id === active;
          return (
            <Link
              key={tab.id}
              href={tab.id === 'overview' ? '/admin/command-center' : `/admin/command-center?tab=${tab.id}`}
              aria-current={isActive ? 'page' : undefined}
              className={cn(
                'flex items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-2 text-xs font-semibold transition',
                isActive ? 'bg-ink-950 text-white shadow-sm' : 'text-ink-600 hover:bg-ink-50 hover:text-ink-900'
              )}
            >
              {tab.label}
              {tab.id === 'overview' && urgentCount > 0 ? (
                <span
                  className={cn(
                    'flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-bold',
                    isActive ? 'bg-red-500 text-white' : 'bg-red-600 text-white'
                  )}
                  aria-label={`${urgentCount} urgent action(s)`}
                >
                  {urgentCount}
                </span>
              ) : null}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
