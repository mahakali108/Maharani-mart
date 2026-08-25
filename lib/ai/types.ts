import type { z } from 'zod';
import type { UserRole } from '@/lib/auth/roles';
import type { createClient } from '@/lib/supabase/server';

export type AISurface = 'retailer' | 'salesman' | 'staff' | 'admin';
export type AIActionClass = 'READ' | 'PREPARE' | 'WRITE' | 'SENSITIVE';
export type AIProviderName = 'openai' | 'gemini' | 'openai-compatible';

export interface AIActor {
  id: string;
  role: UserRole;
  fullName: string;
  surface: AISurface;
}

export type AICardType =
  | 'product'
  | 'scheme'
  | 'cart'
  | 'order'
  | 'credit'
  | 'invoice'
  | 'inventory'
  | 'insight'
  | 'confirmation'
  | 'notice';

export interface AICardAction {
  type: 'link' | 'prompt' | 'confirm_tool';
  label: string;
  href?: string;
  value?: string;
  confirmationToken?: string;
  tone?: 'primary' | 'secondary' | 'danger';
}

export interface AICard {
  type: AICardType;
  id?: string;
  title: string;
  subtitle?: string;
  badge?: string;
  imageUrl?: string;
  metrics?: { label: string; value: string; quality?: 'verified' | 'estimate' | 'unavailable' }[];
  lines?: { label: string; value: string; detail?: string }[];
  source?: string;
  quality?: 'verified' | 'estimate' | 'unavailable';
  actions?: AICardAction[];
}

export interface AIToolResult<T = unknown> {
  ok: boolean;
  data?: T;
  cards?: AICard[];
  message?: string;
  sourceContext?: string;
  confirmationRequired?: boolean;
  confirmationToken?: string;
}

export interface AIToolContext {
  actor: AIActor;
  supabase: ReturnType<typeof createClient>;
  requestId: string;
  confirmed: boolean;
}

export interface AIToolDefinition<TSchema extends z.ZodTypeAny = z.ZodTypeAny> {
  name: string;
  description: string;
  actionClass: AIActionClass;
  roles: UserRole[];
  surfaces: AISurface[];
  inputSchema: TSchema;
  inputJsonSchema: Record<string, unknown>;
  execute: (input: z.infer<TSchema>, context: AIToolContext) => Promise<AIToolResult>;
}

export interface ProviderTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface ProviderToolCall {
  id: string;
  name: string;
  argumentsJson: string;
}

export type ProviderMessage =
  | { role: 'system' | 'user'; content: string }
  | { role: 'assistant'; content: string | null; toolCalls?: ProviderToolCall[] }
  | { role: 'tool'; content: string; toolCallId: string };

export type ProviderEvent =
  | { type: 'text_delta'; text: string }
  | { type: 'tool_calls'; calls: ProviderToolCall[] }
  | { type: 'usage'; inputTokens?: number; outputTokens?: number; totalTokens?: number }
  | { type: 'done' };

export interface AIProvider {
  readonly name: AIProviderName;
  readonly model: string;
  readonly capabilities: { tools: boolean; streaming: boolean; vision: boolean; audio: boolean };
  stream(messages: ProviderMessage[], tools: ProviderTool[]): AsyncGenerator<ProviderEvent>;
}

export type AgentEvent =
  | { type: 'meta'; requestId: string; provider: string; model: string }
  | { type: 'text'; delta: string }
  | { type: 'cards'; cards: AICard[] }
  | { type: 'tool'; name: string; status: 'started' | 'completed' | 'failed' }
  | { type: 'error'; message: string; code: string }
  | { type: 'done'; usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number } };

export interface AIChatHistoryItem {
  role: 'user' | 'assistant';
  content: string;
}
