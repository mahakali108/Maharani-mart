import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { authenticateAIRequest } from '@/lib/ai/authenticate';
import { resetBusinessMemory } from '@/lib/ai/memory/business-memory';
import { isTrustedAIOrigin } from '@/lib/ai/safety/auth';
import { logAIEvent } from '@/lib/ai/observability';

export const runtime = 'nodejs';

const bodySchema = z.object({ surface: z.enum(['retailer', 'salesman', 'staff', 'admin']) });

export async function DELETE(request: NextRequest) {
  if (!isTrustedAIOrigin(request.url, request.headers.get('origin'), process.env.NEXT_PUBLIC_SITE_URL)) {
    return NextResponse.json({ error: 'Untrusted request origin.' }, { status: 403 });
  }
  let raw: unknown;
  try { raw = await request.json(); } catch { return NextResponse.json({ error: 'Invalid request.' }, { status: 400 }); }
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request.' }, { status: 400 });
  const supabase = createClient();
  const auth = await authenticateAIRequest(supabase, parsed.data.surface);
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const started = Date.now();
  const success = await resetBusinessMemory(supabase, auth.actor.id);
  await logAIEvent(supabase, { requestId: crypto.randomUUID(), userId: auth.actor.id, surface: auth.actor.surface, requestType: 'memory_reset', durationMs: Date.now() - started, success, errorCode: success ? undefined : 'database_failure' });
  return success ? NextResponse.json({ success: true }) : NextResponse.json({ error: 'Memory could not be reset.' }, { status: 503 });
}
