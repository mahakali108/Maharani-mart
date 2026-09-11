'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { requirePermission } from '@/lib/admin/guard';

export type ProductFeedbackResult = { error?: string } | { success: true };

const ISSUE_TYPES = ['wrong_information', 'image_problem', 'pricing_problem', 'stock_problem', 'other'] as const;
type IssueType = (typeof ISSUE_TYPES)[number];

const issueSchema = z.object({
  productId: z.string().uuid('Invalid product.'),
  packId: z
    .string()
    .uuid()
    .optional()
    .or(z.literal('')),
  issueType: z.enum(ISSUE_TYPES),
  message: z.string().trim().min(3, 'Describe the problem in a few words.').max(1000),
});

function isIssueType(value: string): value is IssueType {
  return (ISSUE_TYPES as readonly string[]).includes(value);
}

/**
 * Reports a product problem. Everything is verified server-side: the product
 * must exist and be (or have been) visible; RLS confines the row to the
 * caller. Staff review the report — no automated price or data change ever
 * results directly from a report.
 */
export async function reportProductIssueAction(input: {
  productId: string;
  packId?: string | null;
  issueType: string;
  message: string;
}): Promise<ProductFeedbackResult> {
  const user = await requirePermission('orders.create');
  if (user.role !== 'retailer') return { error: 'Only a retailer can report a product problem.' };

  const parsed = issueSchema.safeParse({
    productId: input.productId,
    packId: input.packId || undefined,
    issueType: input.issueType,
    message: input.message,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Please check the report.' };
  }
  if (!isIssueType(parsed.data.issueType)) return { error: 'Please choose a problem type.' };

  const supabase = createClient();
  const { data: product } = await supabase
    .from('products')
    .select('id')
    .eq('id', parsed.data.productId)
    .maybeSingle<{ id: string }>();
  if (!product) return { error: 'This product no longer exists.' };

  const { error } = await supabase.from('retailer_product_issues').insert({
    retailer_id: user.id,
    product_id: parsed.data.productId,
    pack_id: parsed.data.packId ?? null,
    issue_type: parsed.data.issueType,
    message: parsed.data.message,
  } as unknown as never);
  if (error) return { error: error.message };

  // Staff visibility via the notification loop used by return requests.
  const { createInAppNotification } = await import('@/lib/notifications/notify');
  const { data: staffProfiles } = await supabase
    .from('profiles')
    .select('id')
    .in('role', ['staff', 'admin', 'super_admin'])
    .eq('is_active', true)
    .returns<{ id: string }[]>();
  for (const staff of staffProfiles ?? []) {
    try {
      await createInAppNotification({
        recipientId: staff.id,
        title: 'Product problem reported',
        body: `A retailer reported a "${parsed.data.issueType.replace(/_/g, ' ')}" problem: ${parsed.data.message}`,
        linkUrl: '/admin/products',
      });
    } catch (error) {
      console.error('Issue recorded but staff notification failed.', error);
    }
  }

  return { success: true };
}

/**
 * Toggles a pack-level "notify me when available" alert for the caller.
 * The pack must exist; RLS keeps rows owner-only.
 */
export async function toggleStockAlertAction(packId: string, subscribe: boolean): Promise<ProductFeedbackResult> {
  const user = await requirePermission('orders.create');
  if (user.role !== 'retailer') return { error: 'Only a retailer can manage stock alerts.' };
  if (!packId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(packId)) {
    return { error: 'Invalid pack.' };
  }

  const supabase = createClient();
  const { data: pack } = await supabase
    .from('product_packs')
    .select('id')
    .eq('id', packId)
    .maybeSingle<{ id: string }>();
  if (!pack) return { error: 'This pack no longer exists.' };

  if (subscribe) {
    const { error } = await supabase
      .from('retailer_stock_alerts')
      .upsert({ retailer_id: user.id, pack_id: packId } as unknown as never, { onConflict: 'retailer_id,pack_id' });
    if (error) return { error: error.message };
  } else {
    const { error } = await supabase
      .from('retailer_stock_alerts')
      .delete()
      .eq('retailer_id', user.id)
      .eq('pack_id', packId);
    if (error) return { error: error.message };
  }

  revalidatePath('/retailer/favorites');
  return { success: true };
}
