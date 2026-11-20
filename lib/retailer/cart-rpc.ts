import type { createClient } from '@/lib/supabase/server';
import type { Database } from '@/types/database.types';

type CartMutationArgs = Database['public']['Functions']['mutate_retailer_cart_line']['Args'];
type CartMutationResponse = {
  data: Database['public']['Functions']['mutate_retailer_cart_line']['Returns'] | null;
  error: { code?: string; message: string } | null;
};

/** Keep the Supabase schema quirk at one boundary while preserving the migration's exact RPC contract. */
export async function mutateRetailerCartLine(
  supabase: Awaited<ReturnType<typeof createClient>>,
  args: CartMutationArgs
): Promise<CartMutationResponse> {
  const callerRpc = supabase as unknown as {
    rpc: (name: 'mutate_retailer_cart_line', rpcArgs: CartMutationArgs) => PromiseLike<CartMutationResponse>;
  };
  return await callerRpc.rpc('mutate_retailer_cart_line', args);
}
