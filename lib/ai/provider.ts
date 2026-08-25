import 'server-only';

import type {
  AIProvider,
  ProviderEvent,
  ProviderMessage,
  ProviderTool,
  ProviderToolCall,
} from '@/lib/ai/types';
import type { AIConfig } from '@/lib/ai/config';

export class AIProviderError extends Error {
  constructor(message: string, public readonly code = 'provider_failure') {
    super(message);
    this.name = 'AIProviderError';
  }
}

interface OpenAIChunk {
  choices?: Array<{
    delta?: {
      content?: string | null;
      tool_calls?: Array<{
        index: number;
        id?: string;
        function?: { name?: string; arguments?: string };
      }>;
    };
  }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
}

function toOpenAIMessage(message: ProviderMessage) {
  if (message.role === 'tool') {
    return { role: 'tool', content: message.content, tool_call_id: message.toolCallId };
  }
  if (message.role === 'assistant' && message.toolCalls?.length) {
    return {
      role: 'assistant',
      content: message.content,
      tool_calls: message.toolCalls.map((call) => ({
        id: call.id,
        type: 'function',
        function: { name: call.name, arguments: call.argumentsJson },
      })),
    };
  }
  return { role: message.role, content: message.content };
}

/** OpenAI Chat Completions-compatible provider. No provider key reaches client code. */
export class OpenAICompatibleProvider implements AIProvider {
  readonly name;
  readonly capabilities = { tools: true, streaming: true, vision: false, audio: false };
  readonly model: string;

  constructor(private readonly config: AIConfig, private readonly fetcher: typeof fetch = fetch) {
    this.name = config.provider;
    this.model = config.model;
  }

  async *stream(messages: ProviderMessage[], tools: ProviderTool[]): AsyncGenerator<ProviderEvent> {
    const body = JSON.stringify({
      model: this.config.model,
      stream: true,
      messages: messages.map(toOpenAIMessage),
      tools: tools.map((tool) => ({
        type: 'function',
        function: { name: tool.name, description: tool.description, parameters: tool.inputSchema },
      })),
      tool_choice: 'auto',
      temperature: 0.2,
      max_tokens: this.config.maxOutputTokens,
    });

    let response: Response | null = null;
    let lastError: unknown;
    for (let attempt = 0; attempt <= this.config.retries; attempt += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs);
      try {
        response = await this.fetcher(`${this.config.baseUrl}/chat/completions`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${this.config.apiKey}`, 'Content-Type': 'application/json' },
          body,
          signal: controller.signal,
        });
        if (response.ok || (response.status < 500 && response.status !== 429)) break;
      } catch (error) {
        lastError = error;
      } finally {
        clearTimeout(timeout);
      }
    }

    if (!response) {
      throw new AIProviderError(lastError instanceof Error && lastError.name === 'AbortError'
        ? 'The AI provider timed out.'
        : 'The AI provider could not be reached.');
    }
    if (!response.ok || !response.body) {
      // Do not include the provider body: it may echo request data.
      throw new AIProviderError(`The AI provider returned status ${response.status}.`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    const calls = new Map<number, ProviderToolCall>();

    const consume = function* (line: string): Generator<ProviderEvent> {
      if (!line.startsWith('data:')) return;
      const payload = line.slice(5).trim();
      if (!payload || payload === '[DONE]') return;
      let chunk: OpenAIChunk;
      try {
        chunk = JSON.parse(payload) as OpenAIChunk;
      } catch {
        return;
      }
      const delta = chunk.choices?.[0]?.delta;
      if (delta?.content) yield { type: 'text_delta', text: delta.content };
      for (const part of delta?.tool_calls ?? []) {
        const existing = calls.get(part.index) ?? { id: '', name: '', argumentsJson: '' };
        if (part.id) existing.id = part.id;
        if (part.function?.name) existing.name += part.function.name;
        if (part.function?.arguments) existing.argumentsJson += part.function.arguments;
        calls.set(part.index, existing);
      }
      if (chunk.usage) {
        yield {
          type: 'usage',
          inputTokens: chunk.usage.prompt_tokens,
          outputTokens: chunk.usage.completion_tokens,
          totalTokens: chunk.usage.total_tokens,
        };
      }
    };

    while (true) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) yield* consume(line.trim());
      if (done) break;
    }
    if (buffer.trim()) yield* consume(buffer.trim());
    if (calls.size > 0) yield { type: 'tool_calls', calls: [...calls.values()] };
    yield { type: 'done' };
  }
}

export function createAIProvider(config: AIConfig): AIProvider {
  switch (config.provider) {
    case 'openai':
    case 'gemini':
    case 'openai-compatible':
      return new OpenAICompatibleProvider(config);
  }
}
