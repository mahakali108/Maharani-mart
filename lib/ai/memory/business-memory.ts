import 'server-only';

import type { createClient } from '@/lib/supabase/server';

interface MemoryRow { memory_key: string; memory_value: string; }

/** Loads only allow-listed compact business preferences, never transcripts. */
export async function loadBusinessMemory(
  supabase: ReturnType<typeof createClient>,
  userId: string
): Promise<string[]> {
  const { data } = await supabase
    .from('ai_business_memory' as never)
    .select('memory_key, memory_value')
    .eq('user_id', userId)
    .order('updated_at', { ascending: false })
    .limit(20);
  return ((data ?? []) as unknown as MemoryRow[]).map((row) => `${row.memory_key.replaceAll('_', ' ')}: ${row.memory_value}`);
}

export async function resetBusinessMemory(
  supabase: ReturnType<typeof createClient>,
  userId: string
): Promise<boolean> {
  const { error } = await supabase.from('ai_business_memory' as never).delete().eq('user_id', userId);
  return !error;
}
