'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { requirePermission } from '@/lib/admin/guard';
import type { Database } from '@/types/database.types';

type RouteInsert = Database['public']['Tables']['routes']['Insert'];
type RouteCustomerInsert = Database['public']['Tables']['route_customers']['Insert'];

export type RouteFormState = { error?: string } | null;

const routeSchema = z.object({
  name: z.string().min(2, 'Enter a route name.'),
  salesmanId: z.string().uuid('Select a salesman.'),
  areaId: z.string().uuid().optional().or(z.literal('')),
});

export async function createRouteAction(_prevState: RouteFormState, formData: FormData): Promise<RouteFormState> {
  await requirePermission('routes.manage.all');

  const parsed = routeSchema.safeParse({
    name: formData.get('name'),
    salesmanId: formData.get('salesmanId'),
    areaId: formData.get('areaId'),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid input.' };

  const supabase = createClient();
  const payload: RouteInsert = {
    name: parsed.data.name,
    salesman_id: parsed.data.salesmanId,
    area_id: parsed.data.areaId || null,
  };

  const { data, error } = await supabase.from('routes').insert(payload as unknown as never).select('id').single<{ id: string }>();
  if (error) return { error: error.message };

  revalidatePath('/admin/routes');
  redirect(`/admin/routes/${data.id}`);
}

export async function toggleRouteActiveAction(routeId: string, isActive: boolean) {
  await requirePermission('routes.manage.all');
  const supabase = createClient();
  const { error } = await supabase.from('routes').update({ is_active: isActive } as unknown as never).eq('id', routeId);
  if (error) throw new Error(error.message);
  revalidatePath('/admin/routes');
}

export async function addRetailerToRouteAction(routeId: string, retailerId: string, visitDay: number | null) {
  await requirePermission('routes.manage.all');
  const supabase = createClient();

  const { count } = await supabase
    .from('route_customers')
    .select('id', { count: 'exact', head: true })
    .eq('route_id', routeId);

  const payload: RouteCustomerInsert = {
    route_id: routeId,
    retailer_id: retailerId,
    visit_day: visitDay,
    sort_order: count ?? 0,
  };

  const { error } = await supabase.from('route_customers').insert(payload as unknown as never);
  if (error) throw new Error(error.message.includes('duplicate') ? 'This retailer is already on the route.' : error.message);

  revalidatePath(`/admin/routes/${routeId}`);
}

export async function removeRetailerFromRouteAction(routeCustomerId: string, routeId: string) {
  await requirePermission('routes.manage.all');
  const supabase = createClient();
  const { error } = await supabase.from('route_customers').delete().eq('id', routeCustomerId);
  if (error) throw new Error(error.message);
  revalidatePath(`/admin/routes/${routeId}`);
}
