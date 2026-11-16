# Dual Login — Security Test Report

**Project:** Maharani Traders (`mahakali108/Maharani-mart`)
**Branch:** `arena/a1a3a8cb-maharani-mart` (PR #136)
**Date:** 2026-11-16
**Scope:** the new email-OTP credential path, the shared authorization gate, and the
regression risk to the existing password / phone paths.

**Overall verdict: PASS at the repository level.** 90 new tests, 0 regressions in
232 files / 3567 total tests.

**Production verdict: NOT VERIFIED.** No live OTP was sent, no Gmail delivery was tested, and
email OTP cannot work on the live project until the owner settings in
`docs/repair/GMAIL_SMTP_OWNER_SETUP_GUIDE.md` are applied (see §9).

---

## 1. Threat model

| # | Threat | Asset | Consequence if realised |
|---|---|---|---|
| T1 | Account enumeration via the send-code endpoint | the user table | attacker learns which staff/customers have accounts → targeted phishing |
| T2 | Silent account creation from the login screen | account integrity, invitations | attacker mints an account, bypassing Super Admin approval / seller invitation |
| T3 | Privilege escalation via a browser-supplied role | all roles | retailer/admin escalation to `super_admin` |
| T4 | OTP grants more access than password login | role separation | unapproved retailer reaches a workspace |
| T5 | Brute force of a 6-digit code | any account | account takeover |
| T6 | Email bombing / quota exhaustion via unlimited resend | deliverability | all users unable to sign in |
| T7 | Code leakage (logs, URLs, browser storage, analytics) | the session | takeover from a shared device or log reader |
| T8 | Open redirect after successful sign-in | user trust | token theft via `//evil.example` |
| T9 | Session left alive after a failed authorization decision | suspended account | suspended staff keep a usable cookie |
| T10 | Replay of a used code | the session | reuse of a spent credential |
| T11 | Regression: the new code path weakens the existing password path | all users | silent downgrade of the primary login |
| T12 | New exported Server Action becomes an unguarded endpoint | server surface | reachable internal operation |

---

## 2. Controls, and the test that proves each one

### T1 — Account enumeration

| Control | Test |
|---|---|
| The send step returns one fixed message for every outcome | `auth-otp.test.ts` → *"returns the SAME message for a real address and an unknown one"* |
| The address is masked in the visible copy | *"masks the address in the visible copy"* |
| A "signups not allowed" error is not surfaced | same test (asserts `error` is `undefined`) |
| The verify step never says whether the account exists | `auth-otp-rules.test.ts` → *"never says whether an account exists"* (all 6 messages checked against `not found / no account / does not exist / unregistered / unknown email`) |
| Rate-limit messaging is exempt because it depends on volume, not identity | `auth-otp.test.ts` → *"surfaces throttling without revealing anything about the account"* |

**Verification result:** PASS. Note the deliberate exception in §4 — a *real* reason is shown only
**after** a valid credential has already been accepted.

### T2 — No unintended account creation

| Control | Test |
|---|---|
| `signInWithOtp` is always called with `shouldCreateUser: false` | `auth-otp.test.ts` → *"always sends shouldCreateUser: false"* |
| The resend path uses the same call | `lib/auth/actions.ts` (`resendEmailOtp`) |
| A malformed address never reaches Supabase | *"rejects a malformed address before calling Supabase"* |
| The UI states existing accounts only | `auth-otp-ui.test.tsx` → *"states that existing accounts only — no signup"* |
| Public registration remains the only creation path | `tests/auth-login.test.ts` (unchanged); `registerSellerAction` still refuses |

**Verification result:** PASS.

### T3 — No trusted browser role

| Control | Test |
|---|---|
| Role read from `profiles` keyed by the authenticated uid | `sign-in-gate.ts` |
| A forged `role` field is ignored | `auth-otp.test.ts` → *"ignores an email or role supplied by the browser"* (submits `role=super_admin`, asserts redirect `/retailer/home`) |
| A forged email field is ignored | same test (asserts `verifyOtp` received the cookie address, not `victim@example.com`) |
| Verification without a pending cookie is refused | *"refuses to verify without a pending cookie"* |

**Verification result:** PASS.

### T4 — OTP grants no extra privilege

| Control | Test |
|---|---|
| The **same** gate function gates both credential paths | `lib/auth/sign-in-gate.ts`, called by `loginAction`, `loginWithPhoneAction`, `verifyEmailOtpAction` |
| Deactivated profile → refused both ways | *"refuses a deactivated account…"* and *"applies the identical gate to password login"* |
| Suspended retailer → refused both ways | *"refuses a suspended retailer…"* |
| Pending retailer → `/pending-approval`, never a workspace | *"keeps a pending retailer on the pending-approval path"* |
| No profile row → refused | *"refuses an account with no profile row"* |
| Password login still routes by DB role | *"still signs in an active admin with a password and routes by DB role"* |

**Verification result:** PASS.

### T5 — Brute force

| Control | Layer |
|---|---|
| 6-digit code, exact-length enforced before submission | `normalizeOtpCode` (client **and** server) |
| Project verify limit: `rate_limit_verify = 30`/hour | Supabase |
| Project OTP limit: `rate_limit_otp = 30`/hour | Supabase |
| App attempt counter, 5 per issued code | `OTP_MAX_VERIFY_ATTEMPTS`, stored in an httpOnly cookie |
| Attempts refunded on a *length* rejection (our bug, not a guess) | `isOtpLengthMismatch` branch |

| Test | Result |
|---|---|
| *"rejects a non-numeric or short code without calling Supabase"* | PASS — a malformed entry never spends an attempt |
| *"increments the attempt counter on a wrong code"* | PASS |
| *"locks the form after the maximum attempts"* | PASS |
| *"reports throttling instead of a wrong-code message"* | PASS |

**Residual risk (accepted, documented):** the cookie counter is clearable. It is defence in depth
only; the authoritative limits are Supabase's per-hour counters. With 30 verify attempts/hour against
a 10⁶ space, the probability of hitting a live code in a 10-minute window is ≈3×10⁻⁵.

### T6 — Email bombing / quota exhaustion

| Control | Test |
|---|---|
| Server-computed 60-second cooldown per address | *"does not spend a second email inside the window"* |
| Cooldown survives a page reload (server `sentAt`, not mount time) | `useResendCountdown` seeds from `state.sentAt` |
| Resend allowed once elapsed | *"allows a resend once the window has elapsed"* |
| The resend recipient comes from the cookie, not the form | *"never uses a client-supplied address for a blank-field resend"* |
| Supabase `rate_limit_email_sent` caps the project-wide total | Supabase (**currently 2/hour — see §9**) |

**Verification result:** PASS at app level; the Supabase value must be raised for the feature to be usable.

### T7 — The code never leaks

| Control | Test (`auth-otp.test.ts` → "the code never leaks") |
|---|---|
| No `console.*` in any of the 5 source files | *"never logs the token or the address"* |
| No `localStorage` / `sessionStorage` / `document.cookie` writes | *"never writes to localStorage / sessionStorage / document.cookie"* |
| No `?token=` / `?email=` in any URL or href | *"never puts the email or token in a URL"* |
| Pending email is `httpOnly` + `sameSite=lax` | *"keeps the pending email in an httpOnly cookie"* |
| Cookies are `secure` in production | *"marks the pending cookies secure in production"* |
| Only the masked address reaches the DOM | `auth-otp-ui.test.tsx` → *"shows the masked recipient, never the full address"* |
| Exactly one input named `token`, no hidden duplicates | *"exposes exactly one code entry field named token"* |

**Verification result:** PASS. The code exists in exactly two places: the email, and the user's typed input.

### T8 — Open redirect

| Control | Test |
|---|---|
| Every post-login destination passes `safeRedirectPath` | `verifyEmailOtpAction`, `loginAction`, `loginWithPhoneAction` |
| `//evil.example` is rejected and falls back to the role home | *"can target a protected path only through safeRedirectPath"* |
| Existing allow/deny matrix unchanged | `tests/auth-login.test.ts` → *"safeRedirectPath (open-redirect guard)"* (still green) |

**Verification result:** PASS.

### T9 — No session survives a refusal

| Control | Test |
|---|---|
| `signOut()` before returning any refusal | *"refuses a deactivated account and destroys the fresh session"* (asserts `signOutCalls.count === 1` and `redirectCalls === []`) |
| Same for suspended retailers and missing profiles | corresponding tests |
| Pending OTP cookies cleared on every terminal outcome | *"clears the pending cookies after a successful verification"* |

**Verification result:** PASS.

### T10 — Replay

| Control | Evidence |
|---|---|
| GoTrue invalidates a code after first successful use | Supabase behaviour |
| Pending cookies are deleted on success | *"clears the pending cookies after a successful verification"* |
| `verifyOtp` replaces the session; it never runs alongside one | `GoTrueClient.verifyOtp` (`auth-js@2.110.7`) saves the session it receives |

**Verification result:** PASS (application side). A second replay attempt is rejected by GoTrue.

### T11 — No regression to the existing paths

| Control | Test |
|---|---|
| Password action still calls `signInWithPassword` | *"keeps the password action wired to signInWithPassword"* |
| Both password tabs still render | *"keeps the password and phone tabs on the login screen"* |
| Phone login still shows the password form by default | `auth-otp-ui.test.tsx` → *"still shows the phone + password form by default"* |
| Email tab still shows email + password | *"keeps email + password intact when the email tab is chosen"* |
| Confirmation recovery still present | `tests/auth-login.test.ts` → *"offers confirmation recovery on both login tabs and registration"* |
| Phone redirect still outside try/catch | `tests/auth-login.test.ts` → *"keeps phone-login redirect outside try/catch"* |
| Server client contract intact | `tests/supabase-server-client.test.ts` |

**Verification result:** PASS. 232 files / 3567 tests green.

### T12 — Server-action surface

| Control | Evidence |
|---|---|
| Every exported action is guarded, delegates, or is explicitly allowlisted | `tests/server-action-surface.test.ts` (enforced) |
| The two new public actions carry written justification in the allowlist | `tests/server-action-surface.test.ts` |
| No exported action accepts a Supabase client | same test, rule A |
| An unnecessary user-enumerating action was **removed** | `isEmailOtpAvailableAction` deleted |

**Verification result:** PASS.

---

## 3. Test inventory

| File | Tests | Environment | What it covers |
|---|---|---|---|
| `tests/auth-otp.test.ts` | 35 | node | Server actions, the full security matrix, source-level leak checks |
| `tests/auth-otp-ui.test.tsx` | 19 | jsdom | Tabs, code input, paste, cooldown, alerts, accessibility attributes |
| `tests/auth-otp-rules.test.ts` | 20 | node | Normalisation, length/expiry from config, cooldown maths, error mapping, masking |
| `tests/otp-email-template.test.ts` | 16 | node | Real `{{ .Token }}`, no link, expiry from config, never-share, mobile, no secrets |
| **Total new** | **90** | | |

Full run: **232 test files / 3567 tests, all passing** (baseline before this work: 229 / 3493).

### Existing guards touched — and why that is not a weakening

| Test | Change | Reasoning |
|---|---|---|
| `auth-login.test.ts` — "verifies passwords only through Supabase Auth" | Blanket ban on `signInWithOtp`/`verifyOtp` replaced with a ban on **custom** verification (`bcrypt`, `argon2`, `scrypt`, `timingSafeEqual`) + non-Supabase providers + a positive assertion that verification goes through `supabase.auth.verifyOtp(` | The original test was written when one credential method existed. Its intent was "no hand-rolled credential checks", which the new assertions state more precisely, not less. |
| `auth-login.test.ts` — "stores no plain-text password" | Regex narrowed from the bare word `plaintext` to credential-storage patterns | The word appears in a comment explaining that no such store exists. Storage behaviour is unchanged. |
| `server-action-surface.test.ts` | 2 allowlist entries added with justification | This list **is** the repository's review gate for public flows. Unauthenticated login endpoints have no session to guard with. |

No assertion was deleted. No test was skipped.

---

## 4. Deliberate design decisions that a reviewer may query

**1. A real reason is shown for deactivated / suspended accounts — only after a valid credential.**
After Supabase accepts a password or code, the attacker already holds valid credentials; at that
point "your account is deactivated" is not an oracle, and withholding it leaves a legitimately
suspended retailer unable to understand why they cannot sign in. Before a credential is accepted,
every response is generic.

**2. The resend cooldown is a cookie, not a database row.**
A database-backed limiter would require a migration and service-role writes for an unauthenticated
endpoint. GoTrue's `rate_limit_email_sent` / `rate_limit_otp` already enforce the real ceiling, so
the cookie is a UX guard only. **This is why §9's rate-limit step is load-bearing.**

**3. `flowType: 'implicit'` is pinned in `lib/supabase/server.ts`.**
Under PKCE, `signInWithOtp` mints a code-verifier cookie and requires a *different* email template.
`verifyOtp` needs neither. Pinning the flow removes a second failure mode and a second owner
configuration step. Password and phone login never read `flowType`.

**4. The code length comes from `NEXT_PUBLIC_AUTH_OTP_LENGTH`, never from the request.**
Length is a project setting; a caller must not be able to influence normalisation. A rejected
length is detected, explained, and does not consume an attempt.

**5. No AAL2 gate on `/admin` was added.**
There are currently **0 accounts** in the project. Enabling an AAL2 requirement now would make
admin access impossible to establish. The order must be: create the first Super Admin → enrol TOTP
→ verify a challenge → then add the gate. Recorded in
`DUAL_LOGIN_GMAIL_SMTP_IMPLEMENTATION_REPORT.md` §8.

**6. Email OTP is not treated as MFA.**
Password + email code are not distinct factor types when the mailbox is the recovery channel for
both. Privileged accounts need TOTP.

---

## 5. Live configuration gaps (security-relevant)

Read from `fhrmsrumsraprvutrpeo` on 2026-11-16. **Nothing was changed.**

| Setting | Live | Risk if left | Severity |
|---|---|---|---|
| `mailer_otp_length = 8` | 8, UI expects 6 | OTP verify fails; mitigated (explained, attempt refunded) | **High — blocks the feature** |
| `smtp_*` all `null` | no custom SMTP | emails unreliable / land in spam | **High — blocks the feature** |
| `rate_limit_email_sent = 2` | 2/hour project-wide | only 2 code emails per hour app-wide | **High** |
| `site_url = http://localhost:3000` | wrong | reset/confirm links point at localhost | **High** |
| `uri_allow_list = ""` | empty | allowlist not enforced for production origins | **Medium** |
| `mailer_otp_exp = 3600` | 60 min | long-lived code | **Medium** |
| `security_captcha_enabled = false` | off | bot abuse of the send endpoint | **Medium** |
| `password_min_length = 6` | 6 | weak admin passwords | **Medium** |
| `password_hibp_enabled = false` | off | breached passwords allowed | **Low–Medium** |
| `mailer_templates_magic_link` contains `{{ .ConfirmationURL }}` | a link, no code | OTP email unusable until replaced | **High** |
| `mfa_totp_*` enabled | enabled | good — but 0 factors enrolled (0 accounts) | **Medium** |

---

## 6. What is proven vs. not proven

| Claim | Status |
|---|---|
| The login screen never creates an account | **PROVEN** (test) |
| The role always comes from the database | **PROVEN** (test) |
| OTP and password use one authorization gate | **PROVEN** (test + code) |
| No code material is logged, URL-encoded or stored client-side | **PROVEN** (test, source scan) |
| Resend is cooldown-limited and attempt-counted | **PROVEN** (test) |
| Password and phone login still work | **PROVEN** (tests; UI smoke-checked on a local dev server: `/login` returns 200 with all three tabs and the phone+password form intact) |
| A real OTP email arrives in a real Gmail inbox | **NOT PROVEN** — requires §9 steps and one owner-sent test |
| Verification succeeds against the live project | **NOT PROVEN** — live `mailer_otp_length` is 8 |
| Admin accounts are protected by MFA | **NOT PROVEN / N.A.** — no accounts exist |
| The feature is production-ready | **NO** — blocked on owner configuration |

---

## 7. Reproduction

```bash
npx vitest run tests/auth-otp.test.ts \
               tests/auth-otp-ui.test.tsx \
               tests/auth-otp-rules.test.ts \
               tests/otp-email-template.test.ts

npx vitest run      # full: 232 files / 3567 tests
npx tsc --noEmit    # PASS
npx eslint .        # PASS
npx next build      # PASS
```

---

## 8. Residual risk register

| # | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| R1 | Owner sets OTP length ≠ UI length | **High today** | feature broken | detected + explained + attempt refunded; guide explains the fix |
| R2 | Rate limit left at 2/hour | **High today** | app-wide email outage for sign-in | documented as the most important setting |
| R3 | Code email lands in spam | Medium | users think it is broken | custom SMTP + guide's spam check; deliverability improves with a branded template |
| R4 | Cookie-cleared cooldown | Medium | user can re-request sooner | GoTrue limits remain authoritative |
| R5 | Malicious mailbox-holder takes over an account | Medium | account takeover | TOTP for privileged accounts (§8 of the implementation report) |
| R6 | AAL2 not enforced on `/admin` | Medium | a stolen admin password is enough | TOTP enrolment first, then AAL2 gate |
| R7 | No CAPTCHA on the public send endpoint | Medium | bot-driven email quota burn | enable CAPTCHA (owner step 9) |

---

## 9. Sign-off

| Item | Result |
|---|---|
| Repository security testing | **PASS** — 90 new tests, 0 regressions |
| Existing paths preserved | **PASS** — password + phone unchanged; guards still enforcing |
| Production safety | **NOT VERIFIED — blocked on owner configuration** |
| Gmail delivery | **NOT TESTED — no email sent** |
| Production readiness | **NO** — 11 owner steps in `GMAIL_SMTP_OWNER_SETUP_GUIDE.md` remain |

The reviewer should read the *"NOT PROVEN"* rows in §6 as the authoritative list of what this
change does **not** yet guarantee.
