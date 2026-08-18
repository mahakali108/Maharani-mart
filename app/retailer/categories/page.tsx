import Link from 'next/link';
import { Boxes, ChevronRight, LayoutGrid } from 'lucide-react';
import { StoredImage } from '@/components/media/stored-image';
import { createClient } from '@/lib/supabase/server';
import { requireUser } from '@/lib/auth/session';

interface CategoryRow {
  id: string;
  name: string;
  image_url: string | null;
  parent_id: string | null;
  products: { count: number }[] | null;
}

export default async function CategoriesPage() {
  await requireUser();
  const supabase = createClient();
  const { data } = await supabase
    .from('categories')
    .select('id, name, image_url, parent_id, products(count)')
    .eq('is_active', true)
    .order('sort_order')
    .returns<CategoryRow[]>();

  const categories = (data ?? []).map((category) => ({
    ...category,
    count: category.products?.[0]?.count ?? 0,
  }));
  const parents = categories.filter((category) => !category.parent_id);
  const childrenByParent = new Map<string, typeof categories>();
  for (const category of categories) {
    if (!category.parent_id) continue;
    const list = childrenByParent.get(category.parent_id) ?? [];
    list.push(category);
    childrenByParent.set(category.parent_id, list);
  }

  return (
    <div className="space-y-5 sm:space-y-6">
      <div className="flex items-center gap-1.5 text-[10px] font-semibold text-slate-500 sm:text-xs">
        <Link href="/retailer/home" className="hover:text-primary-600">Home</Link>
        <ChevronRight className="h-3 w-3" />
        <span className="text-slate-800">Categories</span>
      </div>

      <div>
        <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-primary-600">Shop by category</p>
        <h1 className="mt-1 text-xl font-bold tracking-tight text-slate-950 sm:text-3xl">All categories</h1>
        <p className="mt-1 text-xs text-slate-500">Browse Maharani Mart wholesale aisles. Subcategories appear only when they exist in the catalog.</p>
      </div>

      {parents.length === 0 ? (
        <section className="flex min-h-[280px] flex-col items-center justify-center rounded-2xl border border-slate-200 bg-white text-center shadow-sm">
          <Boxes className="h-8 w-8 text-slate-300" />
          <p className="mt-3 text-sm font-semibold text-slate-700">No categories yet</p>
        </section>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {parents.map((category) => {
            const children = childrenByParent.get(category.id) ?? [];
            return (
              <article key={category.id} className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                <Link href={`/retailer/catalog?category=${category.id}`} className="flex items-center gap-3 p-4 hover:bg-slate-50">
                  <span className="relative flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-primary-50 text-primary-600">
                    {category.image_url ? (
                      <StoredImage src={category.image_url} alt="" fill className="object-cover" />
                    ) : (
                      <LayoutGrid className="h-6 w-6" />
                    )}
                  </span>
                  <div className="min-w-0 flex-1">
                    <h2 className="truncate text-sm font-bold text-slate-900">{category.name}</h2>
                    <p className="mt-0.5 text-[11px] text-slate-500">
                      {category.count} product{category.count === 1 ? '' : 's'}
                    </p>
                  </div>
                  <ChevronRight className="h-4 w-4 text-slate-300" />
                </Link>
                {children.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5 border-t border-slate-100 px-4 py-3">
                    {children.map((child) => (
                      <Link
                        key={child.id}
                        href={`/retailer/catalog?category=${child.id}`}
                        className="rounded-full bg-slate-50 px-2.5 py-1 text-[10px] font-semibold text-slate-600 hover:bg-primary-50 hover:text-primary-700"
                      >
                        {child.name}
                        {child.count > 0 ? ` · ${child.count}` : ''}
                      </Link>
                    ))}
                  </div>
                ) : null}
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
