import 'server-only';

import { z } from 'zod';
import type { AIToolDefinition } from '@/lib/ai/types';
import { dbFailure, verified } from '@/lib/ai/tools/helpers';

const schema = z.object({
  key: z.enum(['preferred_category', 'preferred_brand', 'frequent_product', 'typical_order_size', 'reorder_preference']),
  value: z.string().trim().min(1).max(160),
});

export const memoryTools: AIToolDefinition[] = [{
  name: 'remember_business_preference',
  description: 'Save one non-sensitive business preference only after explicit confirmation. Never stores chat transcripts, credentials or payment data.',
  actionClass: 'WRITE',
  roles: ['retailer'],
  surfaces: ['retailer'],
  inputSchema: schema,
  inputJsonSchema: { type: 'object', additionalProperties: false, required: ['key', 'value'], properties: { key: { type: 'string', enum: ['preferred_category', 'preferred_brand', 'frequent_product', 'typical_order_size', 'reorder_preference'] }, value: { type: 'string', maxLength: 160 } } },
  execute: async ({ key, value }, context) => {
    const { error } = await context.supabase.from('ai_business_memory').upsert({ user_id: context.actor.id, memory_key: key, memory_value: value, source: 'user_confirmed' } as never, { onConflict: 'user_id,memory_key,memory_value' });
    return error ? dbFailure() : verified({ saved: true, key }, [{ type: 'notice', title: 'Business preference saved', subtitle: 'You can reset saved preferences from the AI header at any time.', quality: 'verified' }]);
  },
}];
