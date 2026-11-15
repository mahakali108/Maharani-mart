/**
 * Input rules for the marketplace launch decision (pure; shared by the server
 * action and its tests). The database enforces the same rules again in
 * record_marketplace_launch_approval (migration 0098) — this copy only exists
 * to give a readable message before the round trip. It can never widen what
 * the database accepts.
 */

export const ENABLE_CONFIRMATION_PHRASE = 'ENABLE THIRD-PARTY SELLERS';

const PLACEHOLDER = /^(n\/?a|tbd|todo|placeholder|owner input required|pending|none|x{2,}|-+|test|sample|example|dummy|abc|123+)$/i;

export interface MarketplaceDecisionInput {
  enable: boolean;
  ownerReference: string;
  caReference: string;
  reason: string;
  confirmation: string;
}

export type MarketplaceDecisionCheck =
  | { ok: true; value: { enable: boolean; ownerReference: string | null; caReference: string | null; reason: string } }
  | { ok: false; error: string };

function looksLikePlaceholder(value: string): boolean {
  return PLACEHOLDER.test(value.trim());
}

export function validateMarketplaceDecision(input: MarketplaceDecisionInput): MarketplaceDecisionCheck {
  const owner = input.ownerReference.trim();
  const ca = input.caReference.trim();
  const reason = input.reason.trim();

  if (reason.length < 10 || reason.length > 500) {
    return { ok: false, error: 'Write a reason of 10–500 characters. It is kept in the approval history.' };
  }

  if (!input.enable) {
    // Turning the marketplace OFF never needs approvals: closing is always safe.
    return { ok: true, value: { enable: false, ownerReference: null, caReference: null, reason } };
  }

  if (owner.length < 3 || owner.length > 200 || looksLikePlaceholder(owner)) {
    return { ok: false, error: 'Enter the owner approval reference (for example the date and form of the owner’s written approval). Placeholders are not accepted.' };
  }
  if (ca.length < 3 || ca.length > 200 || looksLikePlaceholder(ca)) {
    return { ok: false, error: 'Enter the Chartered Accountant approval reference (for example the CA’s name, membership number and letter date). Placeholders are not accepted.' };
  }
  if (owner.toLowerCase() === ca.toLowerCase()) {
    return { ok: false, error: 'The owner approval and the Chartered Accountant approval must be two separate references.' };
  }
  if (input.confirmation.trim() !== ENABLE_CONFIRMATION_PHRASE) {
    return { ok: false, error: `Type ${ENABLE_CONFIRMATION_PHRASE} exactly to confirm.` };
  }
  return { ok: true, value: { enable: true, ownerReference: owner, caReference: ca, reason } };
}

/** Database refusal -> readable message. Unknown errors are not echoed. */
export function mapMarketplaceDecisionError(message: string | null | undefined): string {
  const text = message ?? '';
  const required = /MARKETPLACE_APPROVAL_REQUIRED:\s*([^\n]*)/.exec(text);
  if (required?.[1]) {
    const detail = required[1].trim();
    return detail.charAt(0).toUpperCase() + detail.slice(1);
  }
  if (/Only an authenticated Super Admin/i.test(text) || /permission denied/i.test(text)) {
    return 'Only a Super Admin can change this. Nothing was changed.';
  }
  if (/could not find the function|schema cache|does not exist/i.test(text)) {
    return 'The marketplace controls are not installed in the database yet (migration 0098). Nothing was changed.';
  }
  return 'The decision could not be recorded. Nothing was changed.';
}
