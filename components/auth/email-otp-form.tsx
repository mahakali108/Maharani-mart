'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useFormState, useFormStatus } from 'react-dom';
import Link from 'next/link';
import { ArrowLeft, Loader2, MailCheck, ShieldCheck } from 'lucide-react';
import {
  requestEmailOtpAction,
  verifyEmailOtpAction,
  type OtpFormState,
} from '@/lib/auth/actions';
import {
  OTP_RESEND_COOLDOWN_SECONDS,
  otpCooldownRemaining,
  normalizeOtpCode,
  resolveOtpCodeLength,
  resolveOtpExpiryMinutes,
} from '@/lib/auth/otp-rules';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { SubmitButton } from '@/components/ui/submit-button';
import { cn } from '@/lib/utils/cn';

const initialOtpState: OtpFormState = null;

/** mm:ss for the resend countdown. */
function formatCountdown(totalSeconds: number): string {
  const safe = Math.max(totalSeconds, 0);
  const minutes = Math.floor(safe / 60);
  const seconds = safe % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

/**
 * Counts down to the next allowed resend.
 *
 * The starting point comes from the SERVER (`state.sentAt`), not from the
 * moment the component mounted, so reloading the page or navigating back does
 * not hand the user a fresh cooldown. The countdown is cosmetic: GoTrue's
 * `rate_limit_email_sent` is the real limiter.
 */
function useResendCountdown(sentAt: number | undefined, cooldownSeconds: number | undefined) {
  const base = cooldownSeconds ?? OTP_RESEND_COOLDOWN_SECONDS;
  // `now` is the only state; `remaining` is derived on every render, so there
  // is no setState-in-effect and the value can never be one tick stale.
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!sentAt) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [sentAt]);

  return otpCooldownRemaining(sentAt, now, base);
}

/** The submit button for the code form, disabling itself while pending. */
function VerifyButton({ disabled, codeLength }: { disabled: boolean; codeLength: number }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending || disabled} className="w-full">
      {pending ? (
        <>
          <Loader2 className="h-4 w-4 animate-spin" />
          Verifying…
        </>
      ) : (
        `Verify ${codeLength}-digit code`
      )}
    </Button>
  );
}

function ResendButton({ disabled, remaining }: { disabled: boolean; remaining: number }) {
  const { pending } = useFormStatus();
  const waiting = pending || remaining > 0 || disabled;
  return (
    <Button type="submit" variant="outline" disabled={waiting} className="w-full" aria-live="polite">
      {pending ? (
        <>
          <Loader2 className="h-4 w-4 animate-spin" />
          Sending…
        </>
      ) : remaining > 0 ? (
        `Resend code in ${formatCountdown(remaining)}`
      ) : (
        'Resend code'
      )}
    </Button>
  );
}

interface OtpDigitsProps {
  length: number;
  error?: string;
  onComplete: (code: string) => void;
}

/**
 * One accessible input, rendered as `length` visual boxes.
 *
 * Deliberately NOT `length` separate inputs: with one input there is a single
 * paste target (the usual way a code arrives), a single form value named
 * `token`, native `autocomplete="one-time-code"` support for iOS/Android SMS
 * and password-manager autofill, and no focus-juggling bugs on mobile. The
 * boxes are decorative and `aria-hidden`; screen readers get the real field.
 */
function OtpDigits({ length, error, onComplete }: OtpDigitsProps) {
  const [value, setValue] = useState('');
  const [focused, setFocused] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleChange = useCallback(
    (raw: string) => {
      const digits = raw.replace(/[\s\u00a0\u2010-\u2015-]/g, '').replace(/[^0-9]/g, '').slice(0, length);
      setValue(digits);
      const complete = normalizeOtpCode(digits, length);
      if (complete) onComplete(complete);
    },
    [length, onComplete]
  );

  const activeIndex = focused ? Math.min(value.length, length - 1) : -1;
  const boxes = useMemo(() => Array.from({ length }, (_, i) => i), [length]);

  return (
    <div className="space-y-1.5">
      <Label htmlFor="otp-token">Sign-in code</Label>
      <div
        className="relative"
        onClick={() => inputRef.current?.focus()}
        role="presentation"
      >
        <div className="flex justify-center gap-2" aria-hidden="true">
          {boxes.map((index) => {
            const char = value[index] ?? '';
            return (
              <div
                key={index}
                className={cn(
                  'flex h-12 w-10 items-center justify-center rounded-xl border bg-white text-lg font-semibold text-ink-900 transition-colors sm:h-14 sm:w-12',
                  error ? 'border-primary-400' : 'border-ink-200',
                  activeIndex === index && 'border-primary-600 ring-2 ring-primary-600/20',
                  char && 'border-ink-300'
                )}
              >
                {char || <span className="text-ink-300">•</span>}
              </div>
            );
          })}
        </div>
        <Input
          ref={inputRef}
          id="otp-token"
          name="token"
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9]*"
          maxLength={length}
          value={value}
          onChange={(event) => handleChange(event.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          required
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? 'otp-token-error' : 'otp-token-help'}
          /* Visually replaced by the boxes, but kept in the accessibility tree
             and in the form so the value is submitted and focusable. */
          className="absolute inset-0 h-full w-full cursor-text opacity-0"
        />
      </div>
      {error ? (
        <p id="otp-token-error" role="alert" className="text-center text-xs text-primary-600">
          {error}
        </p>
      ) : (
        <p id="otp-token-help" className="text-center text-xs text-ink-400">
          Paste the whole code — it fills automatically.
        </p>
      )}
    </div>
  );
}

/**
 * Email OTP sign-in. Two stages:
 *   enter  → email address → "Send code"
 *   verify → code boxes + resend (cooldown) + start over
 *
 * The email for verification is held server-side in an httpOnly cookie; this
 * component only ever displays a masked hint of it.
 */
export function EmailOtpForm({ redirectTo }: { redirectTo?: string }) {
  const [requestState, requestAction] = useFormState(requestEmailOtpAction, initialOtpState);
  const [verifyState, verifyAction] = useFormState(verifyEmailOtpAction, initialOtpState);

  // Derived, not stored: the server response is the single source of truth for
  // which stage we are on, so there is no effect-driven state to fall out of
  // sync (and no cascading render). `overridden` only lets the user step BACK.
  const [overrideEnter, setOverrideEnter] = useState(false);

  const codeLength = verifyState?.codeLength ?? requestState?.codeLength ?? resolveOtpCodeLength();
  const expiryMinutes = resolveOtpExpiryMinutes();
  const maskedEmail = verifyState?.maskedEmail ?? requestState?.maskedEmail;

  const serverWantsVerify = requestState?.stage === 'verify' || verifyState?.stage === 'verify';
  const stage: 'enter' | 'verify' = serverWantsVerify && !overrideEnter ? 'verify' : 'enter';

  const remaining = useResendCountdown(
    requestState?.sentAt ?? verifyState?.sentAt,
    requestState?.cooldownSeconds ?? verifyState?.cooldownSeconds
  );

  const backToEmail = (
    <button
      type="button"
      onClick={() => setOverrideEnter(true)}
      className="inline-flex items-center gap-1 text-xs font-medium text-ink-500 hover:text-ink-700"
    >
      <ArrowLeft className="h-3.5 w-3.5" />
      Use a different email
    </button>
  );

  if (stage === 'verify') {
    const error = verifyState?.error;
    return (
      <div className="space-y-4">
        <div className="flex items-start gap-2 rounded-xl border border-mint-200 bg-mint-50 px-4 py-3 text-sm text-mint-800">
          <MailCheck className="mt-0.5 h-4 w-4 shrink-0" />
          <p>
            {requestState?.success ?? verifyState?.success ?? 'If this email belongs to an account, a sign-in code is on its way.'}
            {maskedEmail ? <span className="mt-0.5 block text-xs text-mint-700">Sent to {maskedEmail}</span> : null}
          </p>
        </div>

        {verifyState?.warning ? (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            {verifyState.warning}
          </div>
        ) : null}

        {error ? (
          <div role="alert" className="rounded-xl border border-primary-200 bg-primary-50 px-4 py-3 text-sm text-primary-700">
            {error}
          </div>
        ) : null}

        {verifyState?.configMismatch ? (
          <p className="text-center text-xs text-ink-500">
            An administrator must correct the code length before email sign-in can
            work. Password sign-in is unaffected.
          </p>
        ) : null}

        {verifyState?.code === 'account_suspended' || verifyState?.code === 'account_inactive' ? (
          <p className="text-center text-xs text-ink-500">
            Need help?{' '}
            <Link href="/login" className="font-medium text-primary-600 hover:text-primary-700">
              Contact your distributor
            </Link>
          </p>
        ) : null}

        <form action={verifyAction} className="space-y-4">
          {redirectTo ? <input type="hidden" name="redirect" value={redirectTo} /> : null}
          <OtpDigits
            length={codeLength}
            error={verifyState?.fieldErrors?.token}
            onComplete={() => undefined}
          />
          <VerifyButton disabled={false} codeLength={codeLength} />
        </form>

        <form action={requestAction} className="space-y-2">
          {redirectTo ? <input type="hidden" name="redirect" value={redirectTo} /> : null}
          {/* The address is already in the httpOnly cookie; this hidden field
              only keeps the action's schema happy on resend. */}
          <input type="hidden" name="email" value="" />
          <ResendButton disabled={false} remaining={remaining} />
        </form>

        <div className="flex flex-col items-center gap-2 text-center">
          <p className="text-xs text-ink-400">
            Code expires in {expiryMinutes} minutes. Never share it with anyone.
          </p>
          {backToEmail}
        </div>
      </div>
    );
  }

  return (
    <form action={requestAction} className="space-y-4">
      {redirectTo ? <input type="hidden" name="redirect" value={redirectTo} /> : null}

      {requestState?.error ? (
        <div role="alert" className="rounded-xl border border-primary-200 bg-primary-50 px-4 py-3 text-sm text-primary-700">
          {requestState.error}
        </div>
      ) : null}

      <div>
        <Label htmlFor="otp-email">Email address</Label>
        <Input
          id="otp-email"
          name="email"
          type="email"
          autoComplete="email"
          placeholder="you@business.com"
          required
          aria-describedby="otp-email-help"
        />
        {requestState?.fieldErrors?.email ? (
          <p className="mt-1 text-xs text-primary-600">{requestState.fieldErrors.email}</p>
        ) : (
          <p id="otp-email-help" className="mt-1 text-xs text-ink-400">
            No password needed — we email you a {codeLength}-digit code.
          </p>
        )}
      </div>

      <SubmitButton pendingLabel="Sending code…">Send code</SubmitButton>

      <div className="flex items-start gap-2 rounded-xl bg-ink-50 px-3.5 py-3 text-xs leading-5 text-ink-500">
        <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-mint-600" />
        <p>
          Sign-in codes work only for accounts that already exist. New retailers should{' '}
          <Link href="/register-retailer" className="font-medium text-primary-600 hover:text-primary-700">
            register their shop
          </Link>
          .
        </p>
      </div>
    </form>
  );
}
