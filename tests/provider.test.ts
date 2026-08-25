import { describe, expect, it, vi } from 'vitest';
import { AIProviderError, OpenAICompatibleProvider } from '@/lib/ai/provider';
import type { AIConfig } from '@/lib/ai/config';

const config: AIConfig = { provider: 'openai-compatible', apiKey: 'server-secret', baseUrl: 'https://provider.invalid/v1', model: 'tool-model', timeoutMs: 100, maxToolRounds: 2, maxToolCalls: 2, maxOutputTokens: 200, retries: 1 };

describe('AI provider failure handling', () => {
  it('maps provider HTTP failures without exposing response bodies or API keys', async () => {
    const provider = new OpenAICompatibleProvider(config, vi.fn(async () => new Response('echo server-secret and private prompt', { status: 500 })) as typeof fetch);
    const consume = async () => { for await (const _event of provider.stream([{ role: 'user', content: 'private' }], [])) { /* consume */ } };
    await expect(consume()).rejects.toBeInstanceOf(AIProviderError);
    await expect(consume()).rejects.not.toThrow(/server-secret|private prompt/);
  });

  it('exposes provider capabilities without claiming vision/audio support', () => {
    const provider = new OpenAICompatibleProvider(config);
    expect(provider.capabilities).toEqual({ tools: true, streaming: true, vision: false, audio: false });
  });
});
