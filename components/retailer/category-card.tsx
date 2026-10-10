import Link from 'next/link';
import { StoredImage } from '@/components/media/stored-image';
import { ChevronRight, LayoutGrid } from 'lucide-react';

export interface CategoryCardData {
  id: string;
  name: string;
  image_url: string | null;
  productCount?: number;
}

/**
 * Category tile.
 *  - compact: circular "aisle" tile (Super Store style) — soft blush frame,
 *    centred label, no heavy border. Used in shortcut rows.
 *  - full: premium card with a 4:3 image, count and chevron. Used in directories.
 */
export function CategoryCard({
  category,
  compact = false,
  href,
}: {
  category: CategoryCardData;
  compact?: boolean;
  /** Optional destination override (e.g. a category detail page). */
  href?: string;
}) {
  const target = href ?? `/retailer/catalog?category=${category.id}`;

  if (compact) {
    return (
      <Link
        href={target}
        aria-label={`Browse ${category.name}`}
        className="group flex h-full min-w-0 flex-col items-center gap-2 rounded-xl px-1 pb-1 pt-1 text-center transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action-500 focus-visible:ring-offset-2"
      >
        <span className="relative flex h-16 w-16 items-center justify-center overflow-hidden rounded-full border border-blush-200 bg-blush-100 shadow-[0_1px_2px_rgba(79,20,36,0.06)] transition duration-200 group-hover:-translate-y-0.5 group-hover:border-primary-300 group-hover:shadow-md sm:h-20 sm:w-20">
          {category.image_url ? (
            <StoredImage
              src={category.image_url}
              alt=""
              fill
              sizes="80px"
              fallback={<LayoutGrid className="h-6 w-6 text-primary-600" aria-hidden="true" />}
              className="object-cover transition duration-300 group-hover:scale-105"
            />
          ) : (
            <LayoutGrid className="h-6 w-6 text-primary-600" aria-hidden="true" />
          )}
        </span>
        <span className="line-clamp-2 min-h-[2.25rem] w-full break-words text-[11px] font-semibold leading-4 text-slate-800 sm:text-xs">
          {category.name}
        </span>
      </Link>
    );
  }

  return (
    <Link
      href={target}
      className="group block h-full overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-card transition duration-200 hover:-translate-y-0.5 hover:border-primary-200 hover:shadow-premium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action-500 focus-visible:ring-offset-2"
    >
      <div className="relative aspect-[4/3] overflow-hidden bg-blush-100">
        {category.image_url ? (
          <StoredImage
            src={category.image_url}
            alt={category.name}
            fill
            sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 280px"
            fallback={<div className="flex h-full items-center justify-center text-primary-600"><LayoutGrid className="h-6 w-6" aria-hidden="true" /></div>}
            className="object-cover transition duration-300 group-hover:scale-105"
          />
        ) : (
          <div className="flex h-full items-center justify-center text-primary-500">
            <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white shadow-sm">
              <LayoutGrid className="h-5 w-5" aria-hidden="true" />
            </span>
          </div>
        )}
      </div>
      <div className="flex items-center gap-2 p-3.5">
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-sm font-semibold text-slate-900">{category.name}</h3>
          {category.productCount != null ? (
            <p className="mt-0.5 text-[11px] text-slate-500">
              {category.productCount} product{category.productCount === 1 ? '' : 's'}
            </p>
          ) : null}
        </div>
        <ChevronRight
          className="h-4 w-4 shrink-0 text-slate-400 transition group-hover:translate-x-0.5 group-hover:text-primary-600"
          aria-hidden="true"
        />
      </div>
    </Link>
  );
}

