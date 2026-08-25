import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { authenticateAIRequest } from '@/lib/ai/authenticate';
import { runMaharaniAgent } from '@/lib/ai/agent';
import { executeBusinessTool } from '@/lib/ai/tools';
import { verifyConfirmationToken } from '@/lib/ai/safety/confirmation';
import { isTrustedAIOrigin } from '@/lib/ai/safety/auth';
import { AI_REQUEST_LIMITS } from '@/lib/ai/safety/constants';
import { localAIRateLimiter } from '@/lib/ai/safety/rate-limit';
import type { AgentEvent, AISurface } from '@/lib/ai/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  surface: z.enum(['retailer', 'salesman', 'staff', 'admin']),
  message: z.string().trim().min(1).max(AI_REQUEST_LIMITS.messageCharacters),
  history: z.array(z.object({ role: z.enum(['user', 'assistant']), content: z.string().trim().min(1).max(AI_REQUEST_LIMITS.messageCharacters) })).max(AI_REQUEST_LIMITS.historyItems).optional().default([]),
  confirmationToken: z.string().min(20).max(20_000).optional(),
}).superRefine((value, context) => {
  const total = value.history.reduce((sum, item) => sum + item.content.length, 0);
  if (total > AI_REQUEST_LIMITS.historyCharacters) context.addIssue({ code: z.ZodIssueCode.custom, path: ['history'], message: 'Conversation history is too long.' });
});

function sseResponse(stream: ReadableStream<Uint8Array>) {
  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store, no-transform',
      Connection: 'keep-alive',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

function eventStream(events: AsyncGenerator<AgentEvent>) {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const event of events) controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      } finally {
        controller.close();
      }
    },
  });
}

async function consumeDistributedRateLimit(supabase: ReturnType<typeof createClient>, userId: string) {
  const local = localAIRateLimiter.consume(userId);
  if (!local.allowed) return local;
  const { data, error } = await supabase.rpc('consume_ai_rate_limit' as never, { p_bucket: 'chat', p_limit: 20, p_window_seconds: 60 } as never);
  if (error) return { allowed: false, remaining: 0, retryAfterSeconds: 60, unavailable: true };
  const value = data as unknown as { allowed: boolean; remaining: number; retry_after_seconds: number };
  return { allowed: value.allowed, remaining: value.remaining, retryAfterSeconds: value.retry_after_seconds };
}

async function* confirmedActionEvents(
  surface: AISurface,
  token: string,
  actor: Extract<Awaited<ReturnType<typeof authenticateAIRequest>>, { actor: unknown }>['actor'],
  supabase: ReturnType<typeof createClient>,
  requestId: string
): AsyncGenerator<AgentEvent> {
  try {
    const payload = verifyConfirmationToken(token, actor);
    const { data: consumed, error } = await supabase.rpc('consume_ai_confirmation' as never, { p_nonce: payload.nonce } as never);
    if (error || consumed !== true) {
      yield { type: 'error', code: 'confirmation_replayed', message: 'This confirmation was already used or could not be verified. Please ask Maharani AI again.' };
      return;
    }
    const execution = await executeBusinessTool(payload.tool, payload.args, { actor: { ...actor, surface }, supabase, requestId, confirmed: true });
    if (execution.result.cards?.length) yield { type: 'cards', cards: execution.result.cards };
    const successMessage = payload.tool === 'remember_business_preference'
      ? 'Confirmed. The business preference was saved.'
      : 'Confirmed. The cart change was completed and verified.';
    yield { type: 'text', delta: execution.result.ok ? successMessage : (execution.result.message ?? 'The confirmed action could not be completed.') };
    yield { type: 'done' };
  } catch (error) {
    yield { type: 'error', code: 'invalid_confirmation', message: error instanceof Error ? error.message : 'The confirmation could not be verified.' };
  }
}

export async function POST(request: NextRequest) {
  const contentLength = Number(request.headers.get('content-length') ?? 0);
  if (contentLength > 50_000) return NextResponse.json({ error: 'AI request is too large.' }, { status: 413 });
  if (!isTrustedAIOrigin(request.url, request.headers.get('origin'), process.env.NEXT_PUBLIC_SITE_URL)) {
    return NextResponse.json({ error: 'Untrusted request origin.' }, { status: 403 });
  }

  const supabase = createClient();
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });

  let raw: unknown;
  try { raw = await request.json(); }
  catch { return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 }); }
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: 'Invalid AI request.', issues: parsed.error.flatten() }, { status: 400 });

  const auth = await authenticateAIRequest(supabase, parsed.data.surface);
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const rate = await consumeDistributedRateLimit(supabase, auth.actor.id);
  if (!rate.allowed) {
    return NextResponse.json(
      { error: 'Too many AI requests. Please wait and try again.', code: 'rate_limited' },
      { status: 'unavailable' in rate ? 503 : 429, headers: { 'Retry-After': String(rate.retryAfterSeconds) } }
    );
  }

  const requestId = crypto.randomUUID();
  if (parsed.data.confirmationToken) {
    return sseResponse(eventStream(confirmedActionEvents(parsed.data.surface, parsed.data.confirmationToken, auth.actor, supabase, requestId)));
  }
  return sseResponse(eventStream(runMaharaniAgent({ actor: auth.actor, supabase, requestId, message: parsed.data.message, history: parsed.data.history })));
}
