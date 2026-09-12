/**
 * Pure broadcast-audience definitions shared by the admin composer UI and
 * the server action (and by tests). Keeping this out of the 'use server'
 * file is required: a 'use server' module may only export async functions.
 */
import { z } from 'zod';

/**
 * Audiences the composer can target. Kept as a closed set — no arbitrary
 * recipient lists from the client, so a compromised admin session cannot
 * enumerate users it should not see.
 */
export const BROADCAST_AUDIENCES = [
  { value: 'all_retailers', label: 'All retailers (approved + pending)' },
  { value: 'active_retailers', label: 'Active retailers only' },
  { value: 'all_salesmen', label: 'All sales executives' },
  { value: 'all_staff', label: 'All warehouse staff' },
] as const;

export type BroadcastAudience = (typeof BROADCAST_AUDIENCES)[number]['value'];

export function isBroadcastAudience(value: unknown): value is BroadcastAudience {
  return typeof value === 'string' && BROADCAST_AUDIENCES.some((a) => a.value === value);
}

export const broadcastSchema = z.object({
  title: z.string().trim().min(3, 'Give the notification a title.').max(120),
  body: z.string().trim().min(3, 'Write the message body.').max(1000),
  linkUrl: z
    .string()
    .trim()
    .max(300)
    .refine((value) => value === '' || value.startsWith('/'), 'Links must be internal app paths (starting with /).')
    .optional(),
  audience: z.custom<BroadcastAudience>((value) => isBroadcastAudience(value), 'Choose an audience.'),
  category: z.enum(['transactional', 'promotional']).default('transactional'),
});

export type BroadcastInput = z.input<typeof broadcastSchema>;
export type BroadcastParsed = z.output<typeof broadcastSchema>;
