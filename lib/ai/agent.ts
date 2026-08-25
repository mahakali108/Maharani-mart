import 'server-only';

import type { AIActor, AgentEvent, AIChatHistoryItem, AIToolContext, ProviderMessage } from '@/lib/ai/types';
import type { createClient } from '@/lib/supabase/server';
import { getAIConfig, getFallbackAIConfig } from '@/lib/ai/config';
import { createAIProvider, AIProviderError } from '@/lib/ai/provider';
import { buildSystemPrompt } from '@/lib/ai/prompts/system';
import { executeBusinessTool, providerToolsForContext } from '@/lib/ai/tools';
import { loadBusinessMemory } from '@/lib/ai/memory/business-memory';
import { AI_REQUEST_LIMITS, VERIFICATION_FAILURE_MESSAGE } from '@/lib/ai/safety/constants';
import { logAIEvent } from '@/lib/ai/observability';

function resultForModel(result: Awaited<ReturnType<typeof executeBusinessTool>>['result']): string {
  const safe = {
    ok: result.ok,
    data: result.data,
    message: result.message,
    sourceContext: result.sourceContext,
    confirmationRequired: result.confirmationRequired,
  };
  const serialized = JSON.stringify(safe);
  return serialized.length <= AI_REQUEST_LIMITS.toolResultCharacters
    ? serialized
    : `${serialized.slice(0, AI_REQUEST_LIMITS.toolResultCharacters)}…`;
}

export async function* runMaharaniAgent({
  actor,
  supabase,
  requestId,
  message,
  history,
}: {
  actor: AIActor;
  supabase: ReturnType<typeof createClient>;
  requestId: string;
  message: string;
  history: AIChatHistoryItem[];
}): AsyncGenerator<AgentEvent> {
  const started = Date.now();
  let config;
  try { config = getAIConfig(); }
  catch {
    yield { type: 'error', code: 'not_configured', message: 'AI service temporarily unavailable. You can continue using the normal Maharani Traders features.' };
    return;
  }
  let provider = createAIProvider(config);
  let fallbackConfig = null;
  try { fallbackConfig = getFallbackAIConfig(); } catch { fallbackConfig = null; }
  let fallbackUsed = false;
  const context: AIToolContext = { actor, supabase, requestId, confirmed: false };
  const [memory] = await Promise.all([loadBusinessMemory(supabase, actor.id)]);
  const tools = providerToolsForContext(context);
  const messages: ProviderMessage[] = [
    { role: 'system', content: buildSystemPrompt(actor, memory) },
    ...history.slice(-AI_REQUEST_LIMITS.historyItems).map((item) => ({ role: item.role, content: item.content } as ProviderMessage)),
    { role: 'user', content: message },
  ];
  let callsUsed = 0;
  let usage: { inputTokens?: number; outputTokens?: number; totalTokens?: number } = {};
  let producedText = false;

  yield { type: 'meta', requestId, provider: provider.name, model: provider.model };

  try {
    for (let round = 0; round < config.maxToolRounds; round += 1) {
      let roundText = '';
      let toolCalls: Array<{ id: string; name: string; argumentsJson: string }> = [];
      try {
        for await (const event of provider.stream(messages, tools)) {
          if (event.type === 'text_delta') roundText += event.text;
          if (event.type === 'tool_calls') toolCalls = event.calls;
          if (event.type === 'usage') usage = { inputTokens: event.inputTokens, outputTokens: event.outputTokens, totalTokens: event.totalTokens };
        }
      } catch (error) {
        if (!fallbackUsed && fallbackConfig) {
          fallbackUsed = true;
          provider = createAIProvider(fallbackConfig);
          roundText = '';
          toolCalls = [];
          for await (const event of provider.stream(messages, tools)) {
            if (event.type === 'text_delta') roundText += event.text;
            if (event.type === 'tool_calls') toolCalls = event.calls;
            if (event.type === 'usage') usage = { inputTokens: event.inputTokens, outputTokens: event.outputTokens, totalTokens: event.totalTokens };
          }
        } else {
          throw error;
        }
      }

      if (toolCalls.length === 0) {
        if (!roundText.trim()) roundText = VERIFICATION_FAILURE_MESSAGE;
        // Emit bounded chunks after the final safe round. The HTTP response is
        // still streamed and the UI renders progressively.
        for (let index = 0; index < roundText.length; index += 80) {
          const delta = roundText.slice(index, index + 80);
          producedText = true;
          yield { type: 'text', delta };
        }
        break;
      }

      if (callsUsed + toolCalls.length > config.maxToolCalls) {
        yield { type: 'error', code: 'tool_limit', message: 'I could not complete that safely within the tool-call limit. Please narrow the request.' };
        return;
      }
      callsUsed += toolCalls.length;
      messages.push({ role: 'assistant', content: null, toolCalls });

      const executions = await Promise.all(toolCalls.map(async (call) => {
        yieldProgressPlaceholder();
        let args: unknown;
        try { args = JSON.parse(call.argumentsJson || '{}'); }
        catch { args = null; }
        const execution = await executeBusinessTool(call.name, args, context);
        return { call, execution };
      }));

      for (const { call, execution } of executions) {
        yield { type: 'tool', name: call.name, status: execution.result.ok ? 'completed' : 'failed' };
        if (execution.result.cards?.length) yield { type: 'cards', cards: execution.result.cards };
        messages.push({ role: 'tool', toolCallId: call.id, content: resultForModel(execution.result) });
      }
    }

    if (!producedText && callsUsed > 0) {
      const delta = 'Verified business data is shown in the cards above.';
      yield { type: 'text', delta };
    }
    yield { type: 'done', usage };
    await logAIEvent(supabase, { requestId, userId: actor.id, surface: actor.surface, requestType: 'chat', provider: provider.name, model: provider.model, durationMs: Date.now() - started, success: true, ...usage });
  } catch (error) {
    const code = error instanceof AIProviderError ? error.code : 'agent_failure';
    yield { type: 'error', code, message: 'AI service temporarily unavailable. You can continue using the normal Maharani Traders features.' };
    await logAIEvent(supabase, { requestId, userId: actor.id, surface: actor.surface, requestType: 'chat', provider: provider.name, model: provider.model, durationMs: Date.now() - started, success: false, errorCode: code, ...usage });
  }
}

// Keeps the Promise.all callback free of generator syntax while documenting
// that started events are emitted at orchestration boundaries, not from tasks.
function yieldProgressPlaceholder(): void {}
