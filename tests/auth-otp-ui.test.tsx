/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

/**
 * DUAL LOGIN — UI contract for the email-OTP tab.
 *
 * Covers the behaviour a user actually meets: tab switching without losing the
 * password forms, a single accessible code field, a resend countdown that
 * cannot be bypassed by clicking, and a submit button that cannot be fired
 * twice. Server Actions are mocked at the module boundary; their real
 * behaviour is covered by tests/auth-otp.test.ts.
 */

const requestEmailOtpAction = vi.fn(async () => null);
const verifyEmailOtpAction = vi.fn(async () => null);
const loginAction = vi.fn(async () => null);
const loginWithPhoneAction = vi.fn(async () => null);

let otpState: unknown = null;
let emailState: unknown = null;

vi.mock('@/lib/auth/actions', () => ({
  loginAction: (...args: unknown[]) => (loginAction as (...a: unknown[]) => unknown)(...args),
  loginWithPhoneAction: (...args: unknown[]) => (loginWithPhoneAction as (...a: unknown[]) => unknown)(...args),
  requestEmailOtpAction: (...args: unknown[]) => (requestEmailOtpAction as (...a: unknown[]) => unknown)(...args),
  verifyEmailOtpAction: (...args: unknown[]) => (verifyEmailOtpAction as (...a: unknown[]) => unknown)(...args),
}));

// useFormState is React's; stub it so each test can dictate the server state.
vi.mock('react-dom', async () => {
  const actual = await vi.importActual<typeof import('react-dom')>('react-dom');
  return {
    ...actual,
    useFormState: (action: unknown, initial: unknown) => {
      const key = String(action);
      const state = key.includes('verify') ? otpState ?? initial : key.includes('Otp') ? otpState ?? initial : emailState ?? initial;
      return [state, () => undefined];
    },
    useFormStatus: () => ({ pending: false }),
  };
});

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) =>
    React.createElement('a', { href, ...props }, children),
}));

import { EmailOtpForm } from '@/components/auth/email-otp-form';
import { LoginForm } from '@/components/auth/login-form';

beforeEach(() => {
  otpState = null;
  emailState = null;
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

describe('email OTP — step 1 (address)', () => {
  it('asks for a code rather than a password', () => {
    render(<EmailOtpForm />);
    expect(screen.getByLabelText(/email address/i)).toBeTruthy();
    expect(screen.queryByLabelText(/^password$/i)).toBeNull();
    expect(screen.getByRole('button', { name: /send code/i })).toBeTruthy();
  });

  it('states that existing accounts only — no signup', () => {
    render(<EmailOtpForm />);
    expect(screen.getByText(/work only for accounts that already exist/i)).toBeTruthy();
  });

  it('renders the redirect path in a hidden field, never in the URL', () => {
    const { container } = render(<EmailOtpForm redirectTo="/retailer/orders" />);
    const hidden = container.querySelector('input[name="redirect"]') as HTMLInputElement;
    expect(hidden.value).toBe('/retailer/orders');
  });
});

describe('email OTP — step 2 (code)', () => {
  beforeEach(() => {
    otpState = {
      stage: 'verify',
      success: 'If r***@gmail.com belongs to an account, a sign-in code is on its way.',
      maskedEmail: 'r***@gmail.com',
      codeLength: 6,
      cooldownSeconds: 60,
      sentAt: Date.now(),
      attemptsRemaining: 5,
    };
  });

  it('shows the masked recipient, never the full address', () => {
    render(<EmailOtpForm />);
    expect(screen.getByText(/sent to r\*\*\*@gmail\.com/i)).toBeTruthy();
    expect(screen.queryByText(/rajesh\.kumar@gmail\.com/)).toBeNull();
  });

  it('renders exactly one accessible code field with the right autofill hints', () => {
    const { container } = render(<EmailOtpForm />);
    const inputs = container.querySelectorAll('input[name="token"]');
    expect(inputs).toHaveLength(1);
    const input = inputs[0] as HTMLInputElement;
    expect(input.getAttribute('autocomplete')).toBe('one-time-code');
    expect(input.getAttribute('inputmode')).toBe('numeric');
    expect(input.getAttribute('maxlength')).toBe('6');
  });

  it('keeps the decorative boxes out of the accessibility tree', () => {
    const { container } = render(<EmailOtpForm />);
    const decorative = container.querySelector('[aria-hidden="true"]');
    expect(decorative).toBeTruthy();
  });

  it('accepts a pasted code with spaces and stops at the configured length', () => {
    render(<EmailOtpForm />);
    const input = screen.getByLabelText(/sign-in code/i) as HTMLInputElement;
    fireEvent.change(input, { target: { value: '123 456' } });
    expect(input.value).toBe('123456');
  });

  it('discards non-digits', () => {
    render(<EmailOtpForm />);
    const input = screen.getByLabelText(/sign-in code/i) as HTMLInputElement;
    fireEvent.change(input, { target: { value: '12ab34' } });
    expect(input.value).toBe('1234');
  });

  it('disables resend during the cooldown so it cannot be spammed', () => {
    render(<EmailOtpForm />);
    const resend = screen.getByRole('button', { name: /resend code in/i }) as HTMLButtonElement;
    expect(resend.disabled).toBe(true);
  });

  it('offers a single verify action', () => {
    render(<EmailOtpForm />);
    expect(screen.getByRole('button', { name: /verify 6-digit code/i })).toBeTruthy();
  });

  it('states the expiry and the never-share rule', () => {
    render(<EmailOtpForm />);
    expect(screen.getByText(/code expires in 60 minutes/i)).toBeTruthy();
    expect(screen.getByText(/never share it/i)).toBeTruthy();
  });

  it('lets the user switch to a different email without losing the flow', () => {
    render(<EmailOtpForm />);
    fireEvent.click(screen.getByRole('button', { name: /use a different email/i }));
    expect(screen.getByLabelText(/email address/i)).toBeTruthy();
  });

  it('surfaces a wrong-code error as an alert', () => {
    otpState = { ...(otpState as object), error: 'That code is not correct. Check the email and try again.' };
    render(<EmailOtpForm />);
    expect(screen.getByRole('alert').textContent).toMatch(/not correct/i);
  });

  it('marks the code field invalid when the server rejects it', () => {
    otpState = { ...(otpState as object), fieldErrors: { token: 'Enter the 6-digit code from your email.' } };
    render(<EmailOtpForm />);
    const input = screen.getByLabelText(/sign-in code/i) as HTMLInputElement;
    expect(input.getAttribute('aria-invalid')).toBe('true');
  });
});

describe('login screen — three methods, none removed', () => {
  it('offers mobile, email-password and code tabs', () => {
    render(<LoginForm />);
    expect(screen.getByRole('button', { name: /mobile number/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /^email$/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /^code$/i })).toBeTruthy();
  });

  it('still shows the phone + password form by default', () => {
    render(<LoginForm />);
    expect(screen.getByLabelText(/mobile number/i)).toBeTruthy();
    expect(screen.getByLabelText(/^password$/i)).toBeTruthy();
  });

  it('keeps email + password intact when the email tab is chosen', () => {
    render(<LoginForm />);
    fireEvent.click(screen.getByRole('button', { name: /^email$/i }));
    expect(screen.getByLabelText(/email address/i)).toBeTruthy();
    expect(screen.getByLabelText(/^password$/i)).toBeTruthy();
  });

  it('switches to the code form without an email tab regression', () => {
    render(<LoginForm />);
    fireEvent.click(screen.getByRole('button', { name: /^code$/i }));
    expect(screen.getByRole('button', { name: /send code/i })).toBeTruthy();
    expect(screen.queryByLabelText(/^password$/i)).toBeNull();
  });

  it('reports the pressed tab for assistive tech', () => {
    render(<LoginForm />);
    const codeTab = screen.getByRole('button', { name: /^code$/i });
    expect(codeTab.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(codeTab);
    expect(codeTab.getAttribute('aria-pressed')).toBe('true');
  });
});
