import 'server-only';

import { z } from 'zod';
import type { AIProviderName } from '@/lib/ai/types';

const providerNameSchema = z.enum(['openai', 'gemini', 'openai-compatible']);

export interface AIConfig {
  provider: AIProviderName;
  apiKey: string;
  baseUrl: string;
  model: string;
  timeoutMs: number;
  maxToolRounds: number;
  maxToolCalls: number;
  maxOutputTokens: number;
  retries: number;
}

function defaultBaseUrl(provider: AIProviderName): string {
  if (provider === 'gemini') return 'https://generativelanguage.googleapis.com/v1beta/openai';
  return 'https://api.openai.com/v1';
}

export function getAIConfig(prefix = 'AI'): AIConfig {
  const provider = providerNameSchema.parse(process.env[`${prefix}_PROVIDER`] ?? (prefix === 'AI' ? 'openai-compatible' : undefined));
  const apiKey = process.env[`${prefix}_API_KEY`]?.trim();
  const model = process.env[`${prefix}_MODEL`]?.trim();
  if (!apiKey || !model) throw new Error('Maharani AI provider is not configured.');
  const baseUrl = (process.env[`${prefix}_BASE_URL`]?.trim() || defaultBaseUrl(provider)).replace(/\/$/, '');
  const parsedMaxTokens = Number(process.env.AI_MAX_OUTPUT_TOKENS ?? 900);
  return {
    provider,
    apiKey,
    baseUrl,
    model,
    timeoutMs: 45_000,
    maxToolRounds: 6,
    maxToolCalls: 10,
    maxOutputTokens: Number.isFinite(parsedMaxTokens) ? Math.max(128, Math.min(2000, Math.floor(parsedMaxTokens))) : 900,
    retries: 1,
  };
}

export function getFallbackAIConfig(): AIConfig | null {
  if (!process.env.AI_FALLBACK_API_KEY || !process.env.AI_FALLBACK_MODEL || !process.env.AI_FALLBACK_PROVIDER) return null;
  return getAIConfig('AI_FALLBACK');
}
