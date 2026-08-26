import Link from 'next/link';
import { ChevronRight, LayoutGrid } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { requireUser } from '@/lib/auth/session';
import { CategoryDirectory, type DirectoryCategory } from '@/components/retailer/category-directory';

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
    productCount: category.products?.[0]?.count ?? 0,
  }));
  const parents = categories.filter((category) => !category.parent_id);
  const rootCategories = parents.length > 0 ? parents : categories;
  const directoryCategories: DirectoryCategory[] = rootCategories.map((category) => ({
    id: category.id,
    name: category.name,
    image_url: category.image_url,
    productCount: category.productCount,
    children: categories
      .filter((child) => child.parent_id === category.id)
      .map((child) => ({
        id: child.id,
        name: child.name,
        image_url: child.image_url,
        productCount: child.productCount,
      })),
  }));

  return (
    <div className="space-y-5 sm:space-y-7">
      <div className="flex items-center gap-1.5 text-[10px] font-semibold text-slate-500 sm:text-xs">
        <Link href="/retailer/home" className="hover:text-primary-600">Home</Link>
        <ChevronRight className="h-3 w-3" />
        <span className="text-slate-800">Categories</span>
      </div>

      <section className="rounded-2xl border border-blue-100 bg-gradient-to-r from-blue-50 via-white to-slate-50 p-5 sm:p-7">
        <div className="flex items-start gap-4">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-blue-600 text-white shadow-sm">
            <LayoutGrid className="h-5 w-5" />
          </span>
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-primary-600">Browse the marketplace</p>
            <h1 className="mt-1 text-xl font-bold tracking-tight text-slate-950 sm:text-3xl">Shop by category</h1>
            <p className="mt-1 max-w-2xl text-xs leading-5 text-slate-600 sm:text-sm">
              Explore product aisles, then continue to the existing wholesale listing with your category already selected.
            </p>
          </div>
        </div>
      </section>

      {directoryCategories.length > 0 ? (
        <CategoryDirectory categories={directoryCategories} />
      ) : (
        <section className="flex min-h-[280px] flex-col items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-white px-5 text-center">
          <LayoutGrid className="h-8 w-8 text-slate-300" />
          <p className="mt-3 text-sm font-semibold text-slate-700">No categories yet</p>
          <p className="mt-1 text-xs text-slate-500">Categories will appear as the marketplace catalog is updated.</p>
        </section>
      )}
    </div>
  );
}
