import 'server-only';

import type { AICard, AIToolResult } from '@/lib/ai/types';
import { verificationFailure } from '@/lib/ai/safety/constants';

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function clampPage(value: number | undefined): number {
  return Math.max(1, Math.min(100, Math.floor(value ?? 1)));
}

export function clampLimit(value: number | undefined, fallback = 12): number {
  return Math.max(1, Math.min(30, Math.floor(value ?? fallback)));
}

export function inr(value: number | null | undefined): string {
  return value === null || value === undefined
    ? 'Not available'
    : `₹${Number(value).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function verified<T>(data: T, cards: AICard[] = [], sourceContext = 'Supabase, RLS-scoped current data'): AIToolResult<T> {
  return { ok: true, data, cards, sourceContext };
}

export function unavailable(message?: string): AIToolResult {
  const detail = message ? ` ${message}` : '';
  return {
    ok: false,
    message: `${verificationFailure()}${detail}`,
    cards: [{ type: 'notice', title: 'Data not verified', subtitle: message, quality: 'unavailable' }],
  };
}

export function dbFailure(): AIToolResult {
  return unavailable('Please try again after the business data service is available.');
}

export function sourcePeriod(from: string, to: string, rows: number): string {
  return `${from.slice(0, 10)} to ${to.slice(0, 10)} · ${rows} source row${rows === 1 ? '' : 's'}`;
}
