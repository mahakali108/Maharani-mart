export const VERIFICATION_FAILURE_MESSAGE = "I couldn't verify that from current Maharani Traders data.";

export function verificationFailure(detail?: string) {
  return detail ? `${VERIFICATION_FAILURE_MESSAGE} ${detail}` : VERIFICATION_FAILURE_MESSAGE;
}

export const AI_REQUEST_LIMITS = {
  messageCharacters: 2_000,
  historyItems: 12,
  historyCharacters: 12_000,
  toolResultCharacters: 12_000,
} as const;
