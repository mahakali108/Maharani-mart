'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { inviteExistingSellerAction, retrySellerInviteAction } from '@/lib/admin/seller-actions';
import type { SellerInviteStatus } from '@/lib/admin/sellers-query';
import { Button } from '@/components/ui/button';
import { formatIndiaDate } from '@/lib/datetime/india';

/** Status feedback, not evidence of mail delivery or completed verification. */
export function SellerInvitePanel({ sellerId, sellerStatus, invite, hasMember }: {
  sellerId: string;
  sellerStatus: string;
  invite: SellerInviteStatus | null;
  hasMember: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const canInvite = sellerStatus === 'pending' && !hasMember && !invite?.consumed_at;

  function send() {
    if (!window.confirm('Send a password-setup invitation to the email on this seller record?')) return;
    setMessage(null);
    startTransition(async () => {
      try {
        const result = invite
          ? await retrySellerInviteAction(sellerId)
          : await inviteExistingSellerAction(sellerId);
        setMessage(result.ok ? result.message ?? 'Invitation requested.' : result.error);
        router.refresh();
      } catch {
        setMessage('Invitation status could not be verified. Check Supabase Auth before trying again.');
      }
    });
  }

  return (
    <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs leading-5 text-slate-700">
      {invite?.consumed_at ? (
        <p>Auth account provisioned. {invite.invitation_sent_at
          ? 'Supabase accepted the email invitation request.'
          : 'Email delivery has not been verified.'} Password setup and business approval are separate steps.</p>
      ) : invite ? (
        <p>Invitation reserved for this email; no Auth account is linked yet. The reservation expires on {formatIndiaDate(invite.expires_at)} unless retried.</p>
      ) : hasMember ? (
        <p>A seller login is linked (possibly a legacy account). Verify identity and email ownership before approval.</p>
      ) : (
        <p>No Auth login or invitation is linked. A pre-existing pending seller can be invited here without creating a duplicate business.</p>
      )}
      {canInvite ? <Button type="button" size="sm" variant="outline" className="mt-3" disabled={pending} onClick={send}>
        {pending ? 'Requesting…' : invite ? 'Retry invitation' : 'Invite this seller'}
      </Button> : null}
      {message ? <p role="status" className="mt-2 font-semibold text-slate-800">{message}</p> : null}
    </div>
  );
}
