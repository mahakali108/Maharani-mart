import { ProductCard, type ProductCardProps } from '@/components/retailer/product-card';
import { SectionHeading } from '@/components/retailer/section-heading';

export function ProductRail({
  eyebrow,
  title,
  href,
  linkLabel,
  products,
}: {
  eyebrow?: string;
  title: string;
  href?: string;
  linkLabel?: string;
  products: ProductCardProps[];
}) {
  if (products.length === 0) return null;

  return (
    <section className="space-y-3">
      <SectionHeading eyebrow={eyebrow} title={title} href={href} linkLabel={linkLabel} />
      <div className="scrollbar-none -mx-3 flex gap-2.5 overflow-x-auto px-3 pb-1 sm:mx-0 sm:grid sm:grid-cols-3 sm:gap-3 sm:overflow-visible sm:px-0 lg:grid-cols-5 xl:grid-cols-6">
        {products.map((product) => (
          <div key={product.id} className="w-[10.75rem] shrink-0 sm:w-auto">
            <ProductCard {...product} compact />
          </div>
        ))}
      </div>
    </section>
  );
}
