/**
 * A legacy offers=true row, or a preference saved before a reviewed notice
 * was published, is NOT permission to send marketing. A server-side owner
 * approval switch and the date of the approved notice are both required.
 * This is a conservative delivery control, not a determination of valid
 * statutory consent or WhatsApp/SMS channel permissions.
 */
export function currentOfferRollout() {
  return {
    approved: process.env.PROMOTIONAL_NOTICES_APPROVED === 'true',
    noticePublishedAt: process.env.PROMOTIONAL_NOTICE_PUBLISHED_AT ?? null,
  };
}

export function isOfferEligible(
  prefs: { offer_updates: boolean; offer_preference_recorded_at: string | null } | null | undefined,
  rollout: { approved: boolean; noticePublishedAt: string | null }
): boolean {
  if (!rollout.approved || prefs?.offer_updates !== true || !prefs.offer_preference_recorded_at) return false;
  const notice = Date.parse(rollout.noticePublishedAt ?? '');
  const recorded = Date.parse(prefs.offer_preference_recorded_at);
  return Number.isFinite(notice) && notice > 0 && Number.isFinite(recorded) && recorded >= notice;
}

/** Before approval, keep the saved preference visible but label it paused. */
export function displayOfferPreference(
  prefs: { offer_updates: boolean; offer_preference_recorded_at: string | null } | null | undefined,
  rollout: { approved: boolean; noticePublishedAt: string | null }
): boolean {
  if (prefs?.offer_updates !== true || !prefs.offer_preference_recorded_at) return false;
  return !rollout.approved || isOfferEligible(prefs, rollout);
}
