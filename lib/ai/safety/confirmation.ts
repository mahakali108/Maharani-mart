import 'server-only';

import { createHmac, timingSafeEqual } from 'crypto';
import { z } from 'zod';
import type { AIActor } from '@/lib/ai/types';

const confirmationPayloadSchema = z.object({
  version: z.literal(1),
  actorId: z.string().uuid(),
  role: z.string(),
  surface: z.enum(['retailer', 'salesman', 'staff', 'admin']),
  tool: z.string().min(1).max(80),
  args: z.record(z.unknown()),
  expiresAt: z.number().int().positive(),
  nonce: z.string().min(8).max(80),
});
export type ConfirmationPayload = z.infer<typeof confirmationPayloadSchema>;

function signingSecret(): string {
  const secret = process.env.AI_ACTION_SIGNING_SECRET?.trim();
  if (!secret || secret.length < 32) {
    throw new Error('AI write confirmations are disabled until AI_ACTION_SIGNING_SECRET is configured.');
  }
  return secret;
}

function sign(value: string): string {
  return createHmac('sha256', signingSecret()).update(value).digest('base64url');
}

export function createConfirmationToken(actor: AIActor, tool: string, args: Record<string, unknown>, now = Date.now()): string {
  const payload: ConfirmationPayload = {
    version: 1,
    actorId: actor.id,
    role: actor.role,
    surface: actor.surface,
    tool,
    args,
    expiresAt: now + 10 * 60_000,
    nonce: crypto.randomUUID(),
  };
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${encoded}.${sign(encoded)}`;
}

export function verifyConfirmationToken(token: string, actor: AIActor, now = Date.now()): ConfirmationPayload {
  const [encoded, supplied] = token.split('.');
  if (!encoded || !supplied) throw new Error('Invalid confirmation token.');
  const expected = sign(encoded);
  const suppliedBuffer = Buffer.from(supplied);
  const expectedBuffer = Buffer.from(expected);
  if (suppliedBuffer.length !== expectedBuffer.length || !timingSafeEqual(suppliedBuffer, expectedBuffer)) {
    throw new Error('Invalid confirmation token.');
  }
  let raw: unknown;
  try { raw = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')); }
  catch { throw new Error('Invalid confirmation token.'); }
  const payload = confirmationPayloadSchema.parse(raw);
  if (payload.expiresAt < now) throw new Error('This confirmation has expired. Please ask Maharani AI again.');
  if (payload.actorId !== actor.id || payload.role !== actor.role || payload.surface !== actor.surface) {
    throw new Error('This confirmation does not belong to the current user.');
  }
  return payload;
}
