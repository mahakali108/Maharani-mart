import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { CategoryEditForm } from '@/components/admin/category-edit-form';

interface CategoryDetail {
  id: string;
  name: string;
  parent_id: string | null;
}

export default async function EditCategoryPage({ params }: { params: { id: string } }) {
  const supabase = createClient();

  const [{ data: category }, { data: categoryData }] = await Promise.all([
    supabase.from('categories').select('id, name, parent_id').eq('id', params.id).single<CategoryDetail>(),
    supabase.from('categories').select('id, name').order('name'),
  ]);

  if (!category) notFound();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-ink-950">Edit category</h1>
        <p className="mt-1 text-sm text-ink-500">{category!.name}</p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Category details</CardTitle>
        </CardHeader>
        <CategoryEditForm
          categoryId={category!.id}
          name={category!.name}
          parentId={category!.parent_id}
          categories={categoryData ?? []}
        />
      </Card>
    </div>
  );
}
