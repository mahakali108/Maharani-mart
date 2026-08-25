import 'server-only';

import type { createClient } from '@/lib/supabase/server';

export interface AILogEvent {
  requestId: string;
  userId: string;
  surface: 'retailer' | 'salesman' | 'staff' | 'admin';
  provider?: string;
  model?: string;
  requestType: 'chat' | 'tool' | 'memory_reset';
  toolName?: string;
  durationMs: number;
  success: boolean;
  errorCode?: string;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
}

/** Metadata only: no prompts, tool arguments/results, documents or credentials. */
export async function logAIEvent(
  supabase: ReturnType<typeof createClient>,
  event: AILogEvent
): Promise<void> {
  try {
    await supabase.from('ai_audit_logs' as never).insert({
      request_id: event.requestId,
      user_id: event.userId,
      surface: event.surface,
      provider: event.provider ?? null,
      model: event.model ?? null,
      request_type: event.requestType,
      tool_name: event.toolName ?? null,
      duration_ms: Math.max(0, Math.round(event.durationMs)),
      success: event.success,
      error_code: event.errorCode ?? null,
      input_tokens: event.inputTokens ?? null,
      output_tokens: event.outputTokens ?? null,
      total_tokens: event.totalTokens ?? null,
    } as never);
  } catch {
    // Observability is best-effort and must not alter the business action result.
  }
}
