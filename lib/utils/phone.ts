/**
 * Indian mobile-number normalization — canonical form is 10 digits, 6-9 leading.
 * Accepts:
 *  9876543210
 *  09876543210
 *  +91 9876543210
 *  +919876543210
 *  91-9876543210
 *  +91-98765-43210 etc.
 * Returns normalized 10-digit string or null if invalid.
 */
export function normalizePhone(input: string): string | null {
  if (!input || typeof input !== 'string') return null;
  // Keep digits only
  const digits = input.replace(/\D/g, '');
  if (!digits) return null;

  let normalized: string | null = null;

  if (digits.length === 10) {
    normalized = digits;
  } else if (digits.length === 11 && digits.startsWith('0')) {
    // 0 + 10 digits (common domestic dialing)
    normalized = digits.slice(1);
  } else if (digits.length === 12 && digits.startsWith('91')) {
    // 91 + 10 digits
    normalized = digits.slice(2);
  } else if (digits.length === 13 && digits.startsWith('091')) {
    // 091 prefix edge
    normalized = digits.slice(3);
  } else {
    return null;
  }

  if (!/^[6-9]\d{9}$/.test(normalized)) return null;
  return normalized;
}

export function isValidIndianMobile(input: string): boolean {
  return normalizePhone(input) !== null;
}

/** For display: 9876543210 -> +91 98765 43210 */
export function formatPhoneDisplay(phone10: string): string {
  const n = normalizePhone(phone10);
  if (!n) return phone10;
  return `+91 ${n.slice(0, 5)} ${n.slice(5)}`;
}
