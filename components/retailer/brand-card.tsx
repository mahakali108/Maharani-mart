import Link from 'next/link';
import Image from 'next/image';
import { ArrowUpRight, Tag } from 'lucide-react';
import { cn } from '@/lib/utils/cn';

export interface BrandCardData {
  id: string;
  name: string;
  logo_url: string | null;
  productCount?: number;
}

function BrandMonogram({ name }: { name: string }) {
  const monogram = name
    .split(/\s+/)
    .map((word) => word[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();

  return <span className="text-sm font-black tracking-tight text-blue-700">{monogram || 'B'}</span>;
}

export function BrandCard({
  brand,
  compact = false,
}: {
  brand: BrandCardData;
  compact?: boolean;
}) {
  return (
    <Link
      href={`/retailer/catalog?brand=${brand.id}`}
      className={cn(
        'group flex items-center gap-3 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm transition duration-200 hover:-translate-y-0.5 hover:border-primary-200 hover:shadow-md',
        compact && 'min-h-[4.5rem] rounded-xl p-2.5'
      )}
    >
      <span className={cn('relative flex shrink-0 items-center justify-center overflow-hidden rounded-xl border border-slate-100 bg-slate-50', compact ? 'h-11 w-11' : 'h-16 w-16')}>
        {brand.logo_url ? (
          <Image
            src={brand.logo_url}
            alt={`${brand.name} logo`}
            fill
            sizes={compact ? '44px' : '64px'}
            className="object-contain p-1.5"
            unoptimized
          />
        ) : (
          <BrandMonogram name={brand.name} />
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className={cn('block truncate font-bold text-slate-900', compact ? 'text-[11px]' : 'text-sm')}>{brand.name}</span>
        {!compact ? (
          <span className="mt-0.5 flex items-center gap-1 text-[10px] text-slate-500">
            <Tag className="h-3 w-3" /> {brand.productCount ?? 0} product{brand.productCount === 1 ? '' : 's'}
          </span>
        ) : null}
      </span>
      {!compact ? <ArrowUpRight className="h-4 w-4 shrink-0 text-slate-300 transition group-hover:text-primary-600" /> : null}
    </Link>
  );
}
