'use client';

import { useState, useEffect, useCallback } from 'react';
import { useFormState } from 'react-dom';
import Link from 'next/link';
import { Eye, EyeOff, Mail, ShieldCheck, Smartphone } from 'lucide-react';
import {
  loginAction,
  loginWithPhoneAction,
  sendPhoneOtpAction,
  verifyPhoneOtpAction,
  type FormState,
} from '@/lib/auth/actions';
import { formatPhoneDisplay } from '@/lib/utils/phone';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { SubmitButton } from '@/components/ui/submit-button';

const initialState: FormState = null;

/** How many seconds before the "Resend OTP" link becomes active. */
const RESEND_COOLDOWN = 30;

export function LoginForm({ redirectTo }: { redirectTo?: string }) {
  // Top-level tab: phone OTP (primary), phone+password, or email
  const [activeTab, setActiveTab] = useState<'otp' | 'phonePassword' | 'email'>('otp');

  // --- OTP flow state ---
  const [otpPhone, setOtpPhone] = useState(''); // raw input, validated before send
  const [otpPhase, setOtpPhase] = useState<'enterPhone' | 'enterOtp'>('enterPhone');
  const [sentTo, setSentTo] = useState(''); // E.164 of the number OTP was sent to
  const [resendTimer, setResendTimer] = useState(0);

  const [sendState, sendAction] = useFormState(sendPhoneOtpAction, initialState);
  const [verifyState, verifyAction] = useFormState(verifyPhoneOtpAction, initialState);

  // --- Password flows ---
  const [showPassword, setShowPassword] = useState(false);
  const [showPasswordEmail, setShowPasswordEmail] = useState(false);
  const [phoneState, phoneAction] = useFormState(loginWithPhoneAction, initialState);
  const [emailState, emailAction] = useFormState(loginAction, initialState);

  // Resend countdown
  useEffect(() => {
    if (resendTimer <= 0) return;
    const handle = setInterval(() => setResendTimer((t) => t - 1), 1000);
    return () => clearInterval(handle);
  }, [resendTimer]);

  // When send succeeds, move to OTP phase
  useEffect(() => {
    if (sendState?.success && sendState?.fieldErrors?._phone) {
      setSentTo(sendState.fieldErrors._phone);
      setOtpPhase('enterOtp');
      setResendTimer(RESEND_COOLDOWN);
    }
  }, [sendState]);

  const currentError =
    activeTab === 'otp'
      ? otpPhase === 'enterPhone'
        ? sendState?.error
        : verifyState?.error
      : activeTab === 'phonePassword'
        ? phoneState?.error
        : emailState?.error;

  const currentFieldErrors =
    activeTab === 'otp'
      ? otpPhase === 'enterPhone'
        ? sendState?.fieldErrors
        : verifyState?.fieldErrors
      : activeTab === 'phonePassword'
        ? phoneState?.fieldErrors
        : emailState?.fieldErrors;

  const handleResend = useCallback(() => {
    if (resendTimer > 0) return;
    // Re-trigger the send action by submitting the hidden form
    const form = document.getElementById('otp-send-form') as HTMLFormElement | null;
    if (form) {
      // Update the hidden phone input to the original value
      const phoneInput = form.querySelector('input[name="phone"]') as HTMLInputElement | null;
      if (phoneInput) phoneInput.value = otpPhone;
      form.requestSubmit();
      setResendTimer(RESEND_COOLDOWN);
    }
  }, [resendTimer, otpPhone]);

  const handleChangeNumber = useCallback(() => {
    setOtpPhase('enterPhone');
    setSentTo('');
    setOtpPhone('');
  }, []);

  return (
    <div className="space-y-5">
      {/* Tabs — Mobile OTP primary */}
      <div className="flex rounded-xl bg-ink-50 p-1">
        <button
          type="button"
          onClick={() => {
            setActiveTab('otp');
            setOtpPhase('enterPhone');
          }}
          className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-2.5 text-sm font-medium transition-all ${
            activeTab === 'otp'
              ? 'bg-white text-ink-900 shadow-card border border-ink-100'
              : 'text-ink-500 hover:text-ink-700'
          }`}
          aria-pressed={activeTab === 'otp'}
        >
          <Smartphone className="h-4 w-4" />
          OTP Login
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('phonePassword')}
          className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg px-2 py-2.5 text-xs font-medium transition-all ${
            activeTab === 'phonePassword'
              ? 'bg-white text-ink-900 shadow-card border border-ink-100'
              : 'text-ink-500 hover:text-ink-700'
          }`}
          aria-pressed={activeTab === 'phonePassword'}
        >
          <Smartphone className="h-3.5 w-3.5" />
          Phone + Password
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('email')}
          className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-2.5 text-sm font-medium transition-all ${
            activeTab === 'email'
              ? 'bg-white text-ink-900 shadow-card border border-ink-100'
              : 'text-ink-500 hover:text-ink-700'
          }`}
          aria-pressed={activeTab === 'email'}
        >
          <Mail className="h-4 w-4" />
          Email
        </button>
      </div>

      {/* ========== OTP LOGIN TAB ========== */}
      {activeTab === 'otp' ? (
        otpPhase === 'enterPhone' ? (
          /* --- Phase 1: Enter phone number --- */
          <>
            {currentError ? (
              <div className="rounded-xl border border-primary-200 bg-primary-50 px-4 py-3 text-sm text-primary-700">
                {currentError}
              </div>
            ) : null}

            <form
              id="otp-send-form"
              action={sendAction}
              className="space-y-5"
            >
              {redirectTo ? <input type="hidden" name="redirect" value={redirectTo} /> : null}

              <div>
                <Label htmlFor="otp-phone">Mobile Number</Label>
                <div className="relative">
                  <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-sm text-ink-500 font-semibold">
                    +91
                  </span>
                  <Input
                    id="otp-phone"
                    name="phone"
                    type="tel"
                    inputMode="numeric"
                    autoComplete="tel"
                    placeholder="98765 43210"
                    className="pl-11"
                    value={otpPhone}
                    onChange={(e) => setOtpPhone(e.target.value)}
                    required
                    maxLength={15}
                  />
                </div>
                <p className="mt-1.5 text-xs text-ink-400">
                  We&apos;ll send a 6-digit OTP to this number.
                </p>
                {currentFieldErrors?.phone && !currentFieldErrors?._phone ? (
                  <p className="mt-1 text-xs text-primary-600">{currentFieldErrors.phone}</p>
                ) : null}
              </div>

              <SubmitButton pendingLabel="Sending OTP…">Send OTP</SubmitButton>
            </form>

            <p className="text-center text-sm text-ink-500">
              New retailer?{' '}
              <Link href="/register-retailer" className="font-medium text-primary-600 hover:text-primary-700">
                Register your shop
              </Link>
            </p>
          </>
        ) : (
          /* --- Phase 2: Enter OTP --- */
          <>
            {currentError ? (
              <div className="rounded-xl border border-primary-200 bg-primary-50 px-4 py-3 text-sm text-primary-700">
                {currentError}
              </div>
            ) : null}

            <div className="flex items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3">
              <ShieldCheck className="h-5 w-5 shrink-0 text-emerald-600" aria-hidden="true" />
              <div className="text-sm text-emerald-800">
                <p className="font-semibold">OTP sent to {formatPhoneDisplay(sentTo)}</p>
                <p className="mt-0.5 text-xs text-emerald-600">
                  Check your SMS inbox. The code expires in a few minutes.
                </p>
              </div>
            </div>

            <form action={verifyAction} className="space-y-5">
              <input type="hidden" name="phone" value={sentTo} />
              {redirectTo ? <input type="hidden" name="redirect" value={redirectTo} /> : null}

              <div>
                <Label htmlFor="otp-code">Enter OTP</Label>
                <Input
                  id="otp-code"
                  name="token"
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  placeholder="• • • • • •"
                  className="text-center text-lg tracking-[0.5em] font-bold"
                  required
                  maxLength={6}
                  pattern="[0-9]{6}"
                  autoFocus
                />
                {currentFieldErrors?.token ? (
                  <p className="mt-1 text-xs text-primary-600">{currentFieldErrors.token}</p>
                ) : null}
              </div>

              <SubmitButton pendingLabel="Verifying…">Verify &amp; Sign in</SubmitButton>
            </form>

            <div className="flex items-center justify-center gap-4 text-xs">
              <button
                type="button"
                onClick={handleResend}
                disabled={resendTimer > 0}
                className="font-medium text-primary-600 hover:text-primary-700 disabled:text-slate-400 disabled:cursor-not-allowed"
              >
                {resendTimer > 0 ? `Resend OTP in ${resendTimer}s` : 'Resend OTP'}
              </button>
              <span className="text-slate-300">|</span>
              <button
                type="button"
                onClick={handleChangeNumber}
                className="font-medium text-primary-600 hover:text-primary-700"
              >
                Change number
              </button>
            </div>
          </>
        )
      ) : null}

      {/* ========== PHONE + PASSWORD TAB ========== */}
      {activeTab === 'phonePassword' ? (
        <form action={phoneAction} className="space-y-5">
          {redirectTo ? <input type="hidden" name="redirect" value={redirectTo} /> : null}

          {phoneState?.error ? (
            <div className="rounded-xl border border-primary-200 bg-primary-50 px-4 py-3 text-sm text-primary-700">
              {phoneState.error}
            </div>
          ) : null}

          <div>
            <Label htmlFor="phone">Mobile Number</Label>
            <div className="relative">
              <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-sm text-ink-500">
                +91
              </span>
              <Input
                id="phone"
                name="phone"
                type="tel"
                inputMode="numeric"
                autoComplete="tel"
                placeholder="98765 43210"
                className="pl-11"
                required
              />
            </div>
            <p className="mt-1 text-xs text-ink-400">
              Enter 10-digit number — +91, spaces and dashes are ok.
            </p>
            {phoneState?.fieldErrors?.phone ? (
              <p className="mt-1 text-xs text-primary-600">{phoneState.fieldErrors.phone}</p>
            ) : null}
          </div>

          <div>
            <div className="flex items-center justify-between">
              <Label htmlFor="password_phone" className="mb-0">
                Password
              </Label>
              <Link
                href="/forgot-password"
                className="text-xs font-medium text-primary-600 hover:text-primary-700"
              >
                Forgot password?
              </Link>
            </div>
            <div className="relative mt-1.5">
              <Input
                id="password_phone"
                name="password"
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                placeholder="••••••••"
                className="pr-10"
                required
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-400 hover:text-ink-600"
                tabIndex={-1}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            {phoneState?.fieldErrors?.password ? (
              <p className="mt-1 text-xs text-primary-600">{phoneState.fieldErrors.password}</p>
            ) : null}
          </div>

          <SubmitButton pendingLabel="Signing in…">Sign in</SubmitButton>

          <p className="text-center text-sm text-ink-500">
            New retailer?{' '}
            <Link
              href="/register-retailer"
              className="font-medium text-primary-600 hover:text-primary-700"
            >
              Register your shop
            </Link>
          </p>
          <p className="text-center text-xs text-ink-400">
            Staff / Admin? Use the Email tab to sign in.
          </p>
        </form>
      ) : null}

      {/* ========== EMAIL TAB ========== */}
      {activeTab === 'email' ? (
        <form action={emailAction} className="space-y-5">
          {redirectTo ? <input type="hidden" name="redirect" value={redirectTo} /> : null}

          {emailState?.error ? (
            <div className="rounded-xl border border-primary-200 bg-primary-50 px-4 py-3 text-sm text-primary-700">
              {emailState.error}
            </div>
          ) : null}

          <div>
            <Label htmlFor="email">Email address</Label>
            <Input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              placeholder="you@business.com"
              required
            />
            {emailState?.fieldErrors?.email ? (
              <p className="mt-1 text-xs text-primary-600">{emailState.fieldErrors.email}</p>
            ) : null}
          </div>

          <div>
            <div className="flex items-center justify-between">
              <Label htmlFor="password_email" className="mb-0">
                Password
              </Label>
              <Link
                href="/forgot-password"
                className="text-xs font-medium text-primary-600 hover:text-primary-700"
              >
                Forgot password?
              </Link>
            </div>
            <div className="relative mt-1.5">
              <Input
                id="password_email"
                name="password"
                type={showPasswordEmail ? 'text' : 'password'}
                autoComplete="current-password"
                placeholder="••••••••"
                className="pr-10"
                required
              />
              <button
                type="button"
                onClick={() => setShowPasswordEmail((v) => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-400 hover:text-ink-600"
                tabIndex={-1}
                aria-label={showPasswordEmail ? 'Hide password' : 'Show password'}
              >
                {showPasswordEmail ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            {emailState?.fieldErrors?.password ? (
              <p className="mt-1 text-xs text-primary-600">{emailState.fieldErrors.password}</p>
            ) : null}
          </div>

          <SubmitButton pendingLabel="Signing in…">Sign in</SubmitButton>

          <p className="text-center text-sm text-ink-500">
            New retailer?{' '}
            <Link
              href="/register-retailer"
              className="font-medium text-primary-600 hover:text-primary-700"
            >
              Register your shop
            </Link>
          </p>
        </form>
      ) : null}
    </div>
  );
}
