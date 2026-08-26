import { ProductCard, type ProductCardProps } from '@/components/retailer/product-card';
import { SectionHeading } from '@/components/retailer/section-heading';

export function ProductRail({
  eyebrow,
  title,
  href,
  linkLabel,
  products,
  emptyMessage,
}: {
  eyebrow?: string;
  title: string;
  href?: string;
  linkLabel?: string;
  products: ProductCardProps[];
  /** Render a lightweight marketplace empty state instead of omitting this rail. */
  emptyMessage?: string;
}) {
  if (products.length === 0 && !emptyMessage) return null;

  return (
    <section className="space-y-3">
      <SectionHeading eyebrow={eyebrow} title={title} href={href} linkLabel={linkLabel} />
      {products.length > 0 ? (
        <div className="scrollbar-none -mx-3 flex gap-2.5 overflow-x-auto px-3 pb-1 sm:mx-0 sm:grid sm:grid-cols-3 sm:gap-3 sm:overflow-visible sm:px-0 lg:grid-cols-5 xl:grid-cols-6">
          {products.map((product) => (
            <div key={product.id} className="w-[10.75rem] shrink-0 sm:w-auto">
              <ProductCard {...product} compact />
            </div>
          ))}
        </div>
      ) : (
        <div className="rounded-2xl border border-dashed border-slate-200 bg-white px-4 py-8 text-center text-xs text-slate-500">
          {emptyMessage}
        </div>
      )}
    </section>
  );
}
