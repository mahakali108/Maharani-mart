import Link from 'next/link';
import Image from 'next/image';
import { ChevronRight, LayoutGrid } from 'lucide-react';
import { cn } from '@/lib/utils/cn';

export interface CategoryCardData {
  id: string;
  name: string;
  image_url: string | null;
  productCount?: number;
}

export function CategoryCard({
  category,
  compact = false,
}: {
  category: CategoryCardData;
  compact?: boolean;
}) {
  return (
    <Link
      href={`/retailer/catalog?category=${category.id}`}
      className={cn(
        'group block overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm transition duration-200 hover:-translate-y-0.5 hover:border-primary-200 hover:shadow-md',
        compact && 'rounded-xl'
      )}
    >
      <div className={cn('relative overflow-hidden bg-gradient-to-br from-blue-50 via-slate-50 to-slate-100', compact ? 'aspect-square' : 'aspect-[4/3]')}>
        {category.image_url ? (
          <Image
            src={category.image_url}
            alt={category.name}
            fill
            sizes={compact ? '(max-width: 640px) 108px, 16vw' : '(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 280px'}
            className="object-cover transition duration-300 group-hover:scale-105"
            unoptimized
          />
        ) : (
          <div className="flex h-full items-center justify-center text-blue-500">
            <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/90 shadow-sm">
              <LayoutGrid className="h-5 w-5" />
            </span>
          </div>
        )}
        {!compact ? <div className="absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-slate-950/30 to-transparent" /> : null}
      </div>
      <div className={cn('flex items-center gap-2', compact ? 'min-h-[3.75rem] p-2.5' : 'p-4')}>
        <div className="min-w-0 flex-1">
          <h3 className={cn('truncate font-bold text-slate-900', compact ? 'text-[11px]' : 'text-sm')}>{category.name}</h3>
          {!compact ? (
            <p className="mt-0.5 text-[10px] text-slate-500">
              {category.productCount ?? 0} product{category.productCount === 1 ? '' : 's'}
            </p>
          ) : null}
        </div>
        {!compact ? <ChevronRight className="h-4 w-4 shrink-0 text-slate-300 transition group-hover:translate-x-0.5 group-hover:text-primary-600" /> : null}
      </div>
    </Link>
  );
}
