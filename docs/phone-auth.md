# Phone + Password Login — Supabase-Only Architecture

> **Architecture decision (binding):** Supabase is the ONLY backend and
> Supabase Auth is the single source of truth for authentication. Do NOT
> add Firebase, Firebase Auth, Firebase Blaze, Appwrite, or any other
> authentication provider. OTP is NOT mandatory for login.

## 1. Supported login methods

| # | Method | Server action | Status |
|---|--------|---------------|--------|
| 1 | Phone number + password | `loginWithPhoneAction` (`lib/auth/actions.ts`) | Implemented |
| 2 | Email / Gmail + password | `loginAction` (`lib/auth/actions.ts`) | Implemented (preserved) |

Both tabs live on `/login` (`components/auth/login-form.tsx`). Mobile is
the default tab; staff/admins use the Email tab.

## 2. How phone + password works (Supabase Auth, no second provider)

Supabase Auth's password identity is the **email** identity. Phone login
is resolved server-side to that same identity — the password is always
verified by Supabase Auth, never by app code:

```
browser form (phone + password)
  → loginWithPhoneAction (Server Action, 'use server')
  → normalizePhone() → canonical 10-digit string
  → service-role client (server-only): profiles.phone → profile id
  → admin.getUserById(id) → auth email
  → supabase.auth.signInWithPassword({ email, password })  ← Supabase Auth verifies
  → profiles.role → role home (or safe ?redirect= path)
```

Security properties:

- **No plain-text passwords stored anywhere.** Passwords exist only in
  Supabase Auth (`auth.users`, bcrypt-hashed by Supabase). App tables
  (`profiles`, `retailers`) hold no password material.
- **Service-role key stays server-only.** It is read only in
  `lib/supabase/server.ts` (`createServiceRoleClient`), imported only by
  Server Actions / Route Handlers / server pages. Client components use
  the anon key (`lib/supabase/client.ts`). Regression tests
  (`tests/retailer-enterprise-upgrade.test.ts`,
  `tests/auth-login.test.ts`) fail the build if the key or the factory
  leaks into `'use client'` code or a `NEXT_PUBLIC_` variable.
- **No account enumeration on phone login.** Unknown phone, missing
  email, and wrong password all return the same generic
  `invalid_credentials` message. Only an account that actually resolves
  AND is unconfirmed receives the distinct `email_not_confirmed`
  message, which is required for the confirmation-recovery UX.
- **No open redirect.** `?redirect=` is validated by
  `safeRedirectPath()` (single-leading-slash internal paths only) in
  both login actions and `/auth/callback`.

## 3. Phone normalization (Indian +91)

Single canonical form: **10 digits, leading 6–9** (e.g. `9876543210`).

- Normalizer: `normalizePhone()` in `lib/utils/phone.ts`. Accepts
  `9876543210`, `09876543210`, `+91 98765 43210`, `91-9876543210`, etc.
  Returns the canonical 10 digits or `null`.
- Used consistently in: phone login, retailer registration, staff /
  salesman create + edit (`lib/admin/team-actions.ts`). Display helper:
  `formatPhoneDisplay()` → `+91 98765 43210`.
- Storage: `profiles.phone` is `UNIQUE NOT NULL` (canonical 10 digits).

## 4. Duplicate prevention

| Layer | Mechanism |
|-------|-----------|
| Email | Supabase Auth uniqueness. With "Confirm email" ON, `signUp` with a taken email returns success with an obfuscated user (`identities: []`) — detected by `isDuplicateSignup()` and surfaced as `duplicate_email`. With it OFF, the `already registered` error is mapped to the same code. |
| Phone (pre-check) | `is_phone_registered()` RPC (`0012_…` migration, `SECURITY DEFINER`, returns boolean only — no profile data exposed to anon). |
| Phone (race) | `profiles.phone` UNIQUE constraint + `handle_new_user()` trigger mapping `unique_violation` → `phone_already_registered`, mapped to the `duplicate_phone` field error in both retailer registration and staff creation. |
| Retailer profiles | The trigger creates `profiles` + `retailers` rows atomically on `auth.users` insert (`0011_…`). No app code inserts into `retailers` anymore (admin actions only `update`), so a second profile row cannot be created. PK/FK chain `auth.users ← profiles ← retailers` (all same `id`) keeps them 1:1:1. |

## 5. Preserved flows (untouched by this work)

- Retailer approval: `pending_approval → active / suspended`
  (`lib/admin/retailers-actions.ts`, middleware gate to
  `/pending-approval`, suspension sign-out).
- Roles + routing: `lib/auth/roles.ts`, `middleware.ts` (role homes,
  inactive-account sign-out, 7-day access-period gate for non-super-admin).
- RLS: all policies unchanged (this change ships **no migration** —
  every fix is app-layer; the DB contract from `0001`–`0026` is untouched).
- Cart, checkout, orders, credit, pricing: no changes; they key off
  `auth.uid()` → `retailers.id`, which this work does not alter.

## 6. Error / loading UX matrix

Loading: every auth form uses `SubmitButton`, which disables itself and
shows a spinner + `pendingLabel` via React `useFormStatus` while the
Server Action runs.

| Situation | Code | UX |
|-----------|------|----|
| Wrong email/password | `invalid_credentials` | Generic "Invalid email or password" |
| Wrong phone/password, unknown phone | `invalid_credentials` | Generic "Invalid mobile number or password" (enumeration-safe) |
| Bad phone format | field error | "Enter a valid 10-digit Indian mobile number." |
| Phone already registered (register / staff create) | `duplicate_phone` | Field error "This phone number is already registered." |
| Email already registered (register) | `duplicate_email` | "An account with this email already exists. Please log in instead." |
| Login before email confirmation | `email_not_confirmed` | Actionable message + `ResendConfirmationForm` recovery box |
| Resend rate-limited | `recovery_failed` | "Too many requests. Please wait a minute, then try again." |
| Password recovery (forgot/reset) | — | Enumeration-safe generic success; reset link via `/auth/callback?next=/reset-password` |

## 7. Phone verification via OTP (OPTIONAL, separate flow — not implemented)

OTP is **not** required for login and **not** mandatory anywhere. If the
business later requires verified phone numbers, implement it as a
**separate** Supabase Phone OTP flow alongside (never replacing)
password login:

1. **Supabase Dashboard → Authentication → Sign In / Up → enable
   "Phone" provider.**
2. **Configure an SMS provider** (Supabase has no built-in SMS sender —
   one of these is REQUIRED, configured in Dashboard → Authentication →
   SMS / `auth.sms` settings):
   - Twilio (recommended): Account SID + Auth Token + Messaging Service
     SID or From number; enable "Use Test Credentials" only for staging.
   - MessageBird / Vonage / Twilio Verify: API key + sender/originator.
   - Keep test numbers in the provider's allowlist while testing; Indian
     DLT registration applies for `+91` traffic in production.
3. **App flow (new Server Actions, e.g. `requestPhoneOtpAction` /
   `verifyPhoneOtpAction`):**
   - `supabase.auth.signInWithOtp({ phone: '+91XXXXXXXXXX' })` — Supabase
     sends the SMS via the provider above.
   - `supabase.auth.verifyOtp({ phone, token, type: 'sms' })` — on
     success Supabase marks `auth.users.phone_confirmed_at`.
4. **Do NOT overload password login with OTP.** Keep
   `loginWithPhoneAction` exactly as-is; OTP would be an independent
   "verify my number" step (e.g. on the retailer profile page), gated
   behind an already-authenticated session.
5. **Cost/abuse note:** every OTP is a billable SMS; rate-limit the
   request action per user/IP before enabling.

Until steps 1–2 are done, `signInWithOtp({ phone })` fails with a
provider error — which is why no OTP code path ships in the app today.

## 8. Audit trail (2026-09-08)

Audited before editing: `lib/auth/actions.ts`,
`components/auth/*-form.tsx`, `app/login`, `app/register-retailer`,
`app/auth/callback`, `middleware.ts`, `lib/supabase/*`,
`lib/utils/phone.ts`, `lib/admin/team-actions.ts`,
`lib/admin/retailers-actions.ts`, migrations `0001`/`0002`/`0011`/
`0012`/`0013`, `.env.local.example`.

Findings fixed by this change:

1. **Phone login never succeeded (critical).** `redirect()` was called
   inside a `try` whose bare `catch` swallowed Next.js's internal
   `NEXT_REDIRECT` throw and returned "Invalid mobile number or
   password" instead. The redirect now happens outside the `try/catch`.
2. **Unverified accounts hit a dead end.** "Confirm email" projects
   returned a misleading "Invalid … password" on login; now
   `email_not_confirmed` + resend box.
3. **Duplicate-email signups misreported.** The obfuscated
   `identities: []` success shape is now detected (`duplicate_email`).
4. **Confirmation-pending registration rendered as an error.** Now a
   success message with a resend box.
5. **Staff creation didn't translate the phone-race trigger error.**
   `phone_already_registered` now maps to the friendly duplicate message.

Verified unchanged: no Firebase/Appwrite/Auth provider added (the only
`appwrite://` reference is the legacy media-ref guard that resolves to
`null`; `docs/future-appwrite-migration.md` is documentation-only for
file storage, not auth), no plain-text passwords, no service-role key
in client code, no migration needed, approval/roles/RLS/cart/checkout/
orders untouched.
