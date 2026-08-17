'use client';

import { useState } from 'react';
import { useFormState } from 'react-dom';
import Link from 'next/link';
import { Eye, EyeOff, Smartphone, Mail } from 'lucide-react';
import { loginAction, loginWithPhoneAction, type FormState } from '@/lib/auth/actions';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { SubmitButton } from '@/components/ui/submit-button';

const initialState: FormState = null;

export function LoginForm({ redirectTo }: { redirectTo?: string }) {
  const [activeTab, setActiveTab] = useState<'phone' | 'email'>('phone');
  const [showPassword, setShowPassword] = useState(false);
  const [showPasswordEmail, setShowPasswordEmail] = useState(false);

  const [phoneState, phoneAction] = useFormState(loginWithPhoneAction, initialState);
  const [emailState, emailAction] = useFormState(loginAction, initialState);

  const state = activeTab === 'phone' ? phoneState : emailState;

  return (
    <div className="space-y-5">
      {/* Tabs — Mobile primary */}
      <div className="flex rounded-xl bg-ink-50 p-1">
        <button
          type="button"
          onClick={() => setActiveTab('phone')}
          className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-2.5 text-sm font-medium transition-all ${
            activeTab === 'phone'
              ? 'bg-white text-ink-900 shadow-card border border-ink-100'
              : 'text-ink-500 hover:text-ink-700'
          }`}
          aria-pressed={activeTab === 'phone'}
        >
          <Smartphone className="h-4 w-4" />
          Mobile Number
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

      {activeTab === 'phone' ? (
        <form action={phoneAction} className="space-y-5">
          {redirectTo ? <input type="hidden" name="redirect" value={redirectTo} /> : null}

          {phoneState?.error ? (
            <div className="rounded-xl border border-primary-200 bg-primary-50 px-4 py-3 text-sm text-primary-700">
              {phoneState.error}
            </div>
          ) : null}
          {phoneState?.success ? (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
              {phoneState.success}
            </div>
          ) : null}

          <div>
            <Label htmlFor="phone">Mobile Number</Label>
            <div className="relative">
              <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-sm text-ink-500">+91</span>
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
            <p className="mt-1 text-xs text-ink-400">Enter 10-digit number — +91, spaces and dashes are ok.</p>
            {phoneState?.fieldErrors?.phone ? (
              <p className="mt-1 text-xs text-primary-600">{phoneState.fieldErrors.phone}</p>
            ) : null}
          </div>

          <div>
            <div className="flex items-center justify-between">
              <Label htmlFor="password_phone" className="mb-0">Password</Label>
              <Link href="/forgot-password" className="text-xs font-medium text-primary-600 hover:text-primary-700">
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
            <Link href="/register-retailer" className="font-medium text-primary-600 hover:text-primary-700">
              Register your shop
            </Link>
          </p>
          <p className="text-center text-xs text-ink-400">
            Staff / Admin? Use the Email tab to sign in.
          </p>
        </form>
      ) : (
        <form action={emailAction} className="space-y-5">
          {redirectTo ? <input type="hidden" name="redirect" value={redirectTo} /> : null}

          {emailState?.error ? (
            <div className="rounded-xl border border-primary-200 bg-primary-50 px-4 py-3 text-sm text-primary-700">
              {emailState.error}
            </div>
          ) : null}
          {emailState?.success ? (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
              {emailState.success}
            </div>
          ) : null}

          <div>
            <Label htmlFor="email">Email address</Label>
            <Input id="email" name="email" type="email" autoComplete="email" placeholder="you@business.com" required />
            {emailState?.fieldErrors?.email ? (
              <p className="mt-1 text-xs text-primary-600">{emailState.fieldErrors.email}</p>
            ) : null}
          </div>

          <div>
            <div className="flex items-center justify-between">
              <Label htmlFor="password_email" className="mb-0">Password</Label>
              <Link href="/forgot-password" className="text-xs font-medium text-primary-600 hover:text-primary-700">
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
            <Link href="/register-retailer" className="font-medium text-primary-600 hover:text-primary-700">
              Register your shop
            </Link>
          </p>
        </form>
      )}

      {/* Global error fallback for tab switch */}
      {state?.error && activeTab === 'phone' && phoneState?.error ? null : null}
    </div>
  );
}
