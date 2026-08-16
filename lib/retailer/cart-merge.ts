import 'server-only';
import { createClient } from '@/lib/supabase/server';
import type { Database } from '@/types/database.types';

type CartItemInsert = Database['public']['Tables']['cart_items']['Insert'];

/**
 * The single cart-merge implementation: adds (packId, quantity) lines
 * into a retailer's persistent cart, incrementing the quantity when a
 * line for the same pack already exists. cart_items stores no price —
 * the current effective price is always resolved later by the
 * cart/checkout reads and by createOrderForRetailer at order time.
 *
 * Shared by addToCartAction (catalog/quick-order adds) and
 * addReorderLinesToCartAction (reorder review screen) so the merge
 * semantics can never drift between the two entry points. RLS
 * (cart_owner) independently confines all of these writes to
 * retailer_id = auth.uid().
 */
export async function mergeLinesIntoCart(
  supabase: ReturnType<typeof createClient>,
  retailerId: string,
  lines: { packId: string; quantity: number }[]
): Promise<void> {
  for (const line of lines) {
    const { data: existing } = await supabase
      .from('cart_items')
      .select('id, quantity')
      .eq('retailer_id', retailerId)
      .eq('pack_id', line.packId)
      .maybeSingle<{ id: string; quantity: number }>();

    if (existing) {
      await supabase
        .from('cart_items')
        .update({ quantity: existing.quantity + line.quantity } as unknown as never)
        .eq('id', existing.id);
    } else {
      const payload: CartItemInsert = { retailer_id: retailerId, pack_id: line.packId, quantity: line.quantity };
      await supabase.from('cart_items').insert(payload as unknown as never);
    }
  }
}
