import { createClient } from '@/lib/supabase/server';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { ProductForm } from '@/components/admin/product-form';
import { createProductAction } from '@/lib/admin/products-actions';

interface Option {
  id: string;
  name: string;
}

export default async function NewProductPage() {
  const supabase = createClient();

  const [{ data: brandData }, { data: categoryData }] = await Promise.all([
    supabase.from('brands').select('id, name').eq('is_active', true).order('name'),
    supabase.from('categories').select('id, name').eq('is_active', true).order('name'),
  ]);

  const brands = (brandData ?? []) as Option[];
  const categories = (categoryData ?? []) as Option[];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-ink-950">Add product</h1>
        <p className="mt-1 text-sm text-ink-500">
          Create the base product first — you can add images and pack sizes after saving.
        </p>
      </div>

      {brands.length === 0 || categories.length === 0 ? (
        <div className="rounded-xl border border-primary-200 bg-primary-50 px-4 py-3 text-sm text-primary-700">
          {brands.length === 0 ? 'No brands exist yet. ' : ''}
          {categories.length === 0 ? 'No categories exist yet. ' : ''}
          You can still create the product without them and link one later, or{' '}
          <a href="/admin/catalog" className="underline">
            set up Brands &amp; Categories first
          </a>
          .
        </div>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Product details</CardTitle>
        </CardHeader>
        <ProductForm action={createProductAction} brands={brands} categories={categories} submitLabel="Create product" />
      </Card>
    </div>
  );
}
