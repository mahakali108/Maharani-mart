import type { createClient } from '@/lib/supabase/server';
import type { Database } from '@/types/database.types';

type CartMutationArgs = Database['public']['Functions']['mutate_retailer_cart_line']['Args'];
type CartMutationResponse = {
  data: Database['public']['Functions']['mutate_retailer_cart_line']['Returns'] | null;
  error: { code?: string; message: string } | null;
};

/** Keep the Supabase schema quirk at one boundary while preserving the migration's exact RPC contract. */
export async function mutateRetailerCartLine(
  supabase: ReturnType<typeof createClient>,
  args: CartMutationArgs
): Promise<CartMutationResponse> {
  const callerRpc = supabase as unknown as {
    rpc: (name: 'mutate_retailer_cart_line', rpcArgs: CartMutationArgs) => PromiseLike<CartMutationResponse>;
  };
  return await callerRpc.rpc('mutate_retailer_cart_line', args);
}

/**
 * Source-aware twin (0065 `mutate_retailer_cart_line_ex`): p_seller_offer_id
 * null = the legacy Maharani pack line, otherwise a seller-offer line. The
 * legacy 4-arg RPC above stays byte-identical; offer-less callers may use
 * either. Typed locally until the generated Database types absorb 0062–0068.
 */
export interface CartMutationExArgs {
  p_pack_id: string;
  p_seller_offer_id: string | null;
  p_cart_item_id: string | null;
  p_expected_quantity: number;
  p_quantity: number;
}

export async function mutateRetailerCartLineEx(
  supabase: ReturnType<typeof createClient>,
  args: CartMutationExArgs
): Promise<CartMutationResponse> {
  const callerRpc = supabase as unknown as {
    rpc: (name: 'mutate_retailer_cart_line_ex', rpcArgs: CartMutationExArgs) => PromiseLike<CartMutationResponse>;
  };
  return await callerRpc.rpc('mutate_retailer_cart_line_ex', args);
}
