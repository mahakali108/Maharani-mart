import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import {
  isDuplicateSignup,
  mapSignInError,
  safeRedirectPath,
} from '@/lib/auth/helpers';
import { formatPhoneDisplay, isValidIndianMobile, normalizePhone } from '@/lib/utils/phone';

const root = join(__dirname, '..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');

describe('Indian phone normalization (canonical 10 digits)', () => {
  it.each([
    ['9876543210', '9876543210'],
    ['09876543210', '9876543210'],
    ['+91 98765 43210', '9876543210'],
    ['+919876543210', '9876543210'],
    ['91-9876543210', '9876543210'],
    ['+91-98765-43210', '9876543210'],
  ])('normalizes %s to %s', (input, expected) => {
    expect(normalizePhone(input)).toBe(expected);
  });

  it.each([
    ['', '123', '5876543210', '987654321', '98765432101', 'abcdefghij', '+1 4155551234'],
  ])('rejects invalid input %s', (input) => {
    expect(normalizePhone(input)).toBeNull();
    expect(isValidIndianMobile(input)).toBe(false);
  });

  it('formats canonical numbers for display', () => {
    expect(formatPhoneDisplay('9876543210')).toBe('+91 98765 43210');
    expect(formatPhoneDisplay('+91 9876543210')).toBe('+91 98765 43210');
    expect(formatPhoneDisplay('not-a-number')).toBe('not-a-number');
  });
});

describe('safeRedirectPath (open-redirect guard)', () => {
  it('allows internal paths', () => {
    expect(safeRedirectPath('/retailer/home')).toBe('/retailer/home');
    expect(safeRedirectPath('/admin/dashboard?tab=orders')).toBe('/admin/dashboard?tab=orders');
  });

  it('rejects external / protocol-relative / missing paths', () => {
    expect(safeRedirectPath(undefined)).toBeNull();
    expect(safeRedirectPath('')).toBeNull();
    expect(safeRedirectPath('//evil.com/phish')).toBeNull();
    expect(safeRedirectPath('https://evil.com')).toBeNull();
    expect(safeRedirectPath('javascript://alert(1)')).toBeNull();
  });
});

describe('mapSignInError (login error codes)', () => {
  it('maps unconfirmed-email failures to the recovery code', () => {
    const state = mapSignInError({ message: 'Email not confirmed' }, 'email');
    expect(state.code).toBe('email_not_confirmed');
    expect(state.error).toMatch(/confirm/i);
  });

  it('keeps wrong credentials generic (no enumeration)', () => {
    const email = mapSignInError({ message: 'Invalid login credentials' }, 'email');
    expect(email.code).toBe('invalid_credentials');
    expect(email.error).toBe('Invalid email or password. Please try again.');

    const phone = mapSignInError(null, 'mobile number');
    expect(phone.code).toBe('invalid_credentials');
    expect(phone.error).toBe('Invalid mobile number or password. Please try again.');
  });
});

describe('isDuplicateSignup (Supabase obfuscated-duplicate shape)', () => {
  it('detects already-registered emails when Confirm-email is on', () => {
    expect(isDuplicateSignup({ identities: [] })).toBe(true);
  });

  it('treats fresh signups as new', () => {
    expect(isDuplicateSignup({ identities: [{ id: 'x' }] })).toBe(false);
    expect(isDuplicateSignup(null)).toBe(false);
    expect(isDuplicateSignup(undefined)).toBe(false);
  });
});

describe('Supabase-only auth architecture guards', () => {
  const authSource = read('lib/auth/actions.ts');

  it('verifies passwords only through Supabase Auth', () => {
    expect(authSource).toContain('signInWithPassword');
    expect(authSource).not.toMatch(/signInWithOtp|verifyOtp/);
  });

  it('adds no Firebase / Appwrite / alternate auth provider', () => {
    expect(authSource).not.toMatch(/firebase|appwrite|clerk|auth0|next-auth/i);
    expect(read('lib/supabase/client.ts')).not.toMatch(/firebase|appwrite/i);
    expect(read('lib/supabase/server.ts')).not.toMatch(/firebase|appwrite/i);
  });

  it('stores no plain-text password and exposes no service-role key to auth UI', () => {
    expect(authSource).not.toMatch(/password_hash|hashed_password|plaintext/i);
    for (const file of readdirSync(join(root, 'components/auth'))) {
      const source = read(join('components/auth', file));
      expect(source, file).not.toMatch(/createServiceRoleClient|SUPABASE_SERVICE_ROLE_KEY/);
    }
  });

  it('keeps phone-login redirect outside try/catch (NEXT_REDIRECT must not be swallowed)', () => {
    // The success-path redirect must not sit inside a try block whose
    // bare catch would convert it into an "invalid credentials" return.
    const phoneAction = authSource.slice(
      authSource.indexOf('export async function loginWithPhoneAction'),
      authSource.indexOf('export async function requestPasswordResetAction')
    );
    const redirectIdx = phoneAction.indexOf('redirect(destination)');
    const catchIdx = phoneAction.indexOf('} catch {');
    expect(redirectIdx).toBeGreaterThan(-1);
    expect(catchIdx).toBeGreaterThan(-1);
    expect(redirectIdx).toBeGreaterThan(catchIdx);
  });

  it('offers confirmation recovery on both login tabs and registration', () => {
    expect(read('components/auth/login-form.tsx')).toContain('ResendConfirmationForm');
    expect(read('components/auth/register-retailer-form.tsx')).toContain('ResendConfirmationForm');
  });
});
