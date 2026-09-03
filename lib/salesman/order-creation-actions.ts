'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { requirePermission } from '@/lib/admin/guard';
import { createInAppNotification } from '@/lib/notifications/notify';
import { createOrderForRetailer } from '@/lib/orders/create-order';

const createSalesmanOrderSchema = z.object({
  retailerId: z.string().uuid(),
  notes: z.string().max(1000).default(''),
  /*
   * `quantity` is the number of PIECES the retailer is taking — the same unit
   * the web cart uses, so `createOrderForRetailer` can price it with one rule:
   * floor(qty / unitsPerCase) cases at the case price, the remainder at its
   * loose tier. A salesman can therefore bill 6 loose pcs of a 40-pc case and
   * nothing about the case split is trusted from this client.
   */
  lines: z
    .array(
      z.object({
        packId: z.string().uuid(),
        quantity: z.number().int().positive().max(100000).describe('Quantity in pieces (not cases)'),
      })
    )
    .min(1)
    .max(200),
});

export type SalesmanOrderInput = z.infer<typeof createSalesmanOrderSchema>;
export type SalesmanOrderResult = { error: string } | { success: true; orderId: string };

export async function createSalesmanOrderAction(input: SalesmanOrderInput): Promise<SalesmanOrderResult> {
  const user = await requirePermission('orders.create');
  if (user.role !== 'salesman') return { error: 'Only a salesman can capture an order here.' };

  const parsed = createSalesmanOrderSchema.safeParse(input);
  if (!parsed.success) return { error: 'Check the retailer and product quantities, then try again.' };

  const result = await createOrderForRetailer({
    retailerId: parsed.data.retailerId,
    collectedBy: user.id,
    lines: parsed.data.lines,
    notes: parsed.data.notes,
  });

  if ('error' in result) return result;

  try {
    await createInAppNotification({
      recipientId: parsed.data.retailerId,
      title: 'Order placed by your salesman',
      body: `Order ${result.order.orderNumber} has been created for your shop and is awaiting confirmation.`,
      linkUrl: `/retailer/orders/${result.order.id}`,
    });
  } catch (error) {
    console.error('Salesman order created but retailer notification failed.', error);
  }

  revalidatePath('/salesman/dashboard');
  revalidatePath('/salesman/orders');
  revalidatePath(`/salesman/retailers/${parsed.data.retailerId}`);
  revalidatePath('/retailer/orders');
  return { success: true, orderId: result.order.id };
}
