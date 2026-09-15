/**
 * Support-ticket domain constants and pure helpers.
 *
 * Everything here is side-effect free so the behaviour is unit-testable;
 * the server actions (lib/retailer/support-actions.ts,
 * lib/admin/support-actions.ts) own the Supabase writes and re-verify
 * permissions, and Postgres RLS (migration 0048) is the hard boundary.
 */

export type SupportTopic = 'order' | 'payment' | 'product' | 'delivery' | 'credit' | 'other';

export type SupportPriority = 'low' | 'normal' | 'high' | 'urgent';

export type SupportStatus = 'open' | 'in_progress' | 'resolved' | 'closed';

export const SUPPORT_TOPICS: SupportTopic[] = ['order', 'payment', 'product', 'delivery', 'credit', 'other'];

export const SUPPORT_STATUSES: SupportStatus[] = ['open', 'in_progress', 'resolved', 'closed'];

export const SUPPORT_PRIORITIES: SupportPriority[] = ['low', 'normal', 'high', 'urgent'];

export const SUPPORT_PRIORITY_LABELS: Record<SupportPriority, string> = {
  low: 'Low',
  normal: 'Normal',
  high: 'High',
  urgent: 'Urgent',
};

export const SUPPORT_TOPIC_LABELS: Record<SupportTopic, string> = {
  order: 'Order issue',
  payment: 'Payment / credit',
  product: 'Product issue',
  delivery: 'Delivery issue',
  credit: 'Credit account',
  other: 'Other',
};

export const SUPPORT_STATUS_LABELS: Record<SupportStatus, string> = {
  open: 'Open',
  in_progress: 'In progress',
  resolved: 'Resolved',
  closed: 'Closed',
};

/** A retailer may reply only while the ticket is actionable. */
export function isTicketOpen(status: SupportStatus): boolean {
  return status === 'open' || status === 'in_progress';
}

/**
 * Allowed workflow moves. Retailers never move the status; these transitions
 * are for the admin surface and double as a server-side guard so a tampered
 * status update can never skip or reverse the workflow silently.
 */
export const SUPPORT_STATUS_TRANSITIONS: Record<SupportStatus, SupportStatus[]> = {
  open: ['in_progress', 'resolved', 'closed'],
  in_progress: ['open', 'resolved', 'closed'],
  resolved: ['in_progress', 'closed'],
  closed: [],
};

export function canTransitionStatus(from: SupportStatus, to: SupportStatus): boolean {
  return SUPPORT_STATUS_TRANSITIONS[from]?.includes(to) ?? false;
}

const TICKET_NUMBER_RE = /^MT-TKT-\d{8}-[A-Z0-9]{4}$/;

/**
 * Server-side ticket number: `MT-TKT-YYYYMMDD-XXXX`. The date part is the
 * Asia/Kolkata calendar day (the app's business day) and the suffix is
 * random. The app retries on the unique constraint collision, so two
 * same-day tickets always differ.
 */
export function generateTicketNumber(indiaDateKey: string, suffix: string): string {
  return `MT-TKT-${indiaDateKey.replace(/-/g, '')}-${suffix.toUpperCase()}`;
}

export function isValidTicketNumber(ticketNumber: string): boolean {
  return TICKET_NUMBER_RE.test(ticketNumber);
}
