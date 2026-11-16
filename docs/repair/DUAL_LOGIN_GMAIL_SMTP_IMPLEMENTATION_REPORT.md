# Dual Login (Password + Email OTP) & Gmail SMTP Readiness — Implementation Report

**Project:** Maharani Traders (`mahakali108/Maharani-mart`)
**Supabase project:** `Maharani-mart` — ref `fhrmsrumsraprvutrpeo`
**Branch:** `arena/a1a3a8cb-maharani-mart` (PR #136)
**Date:** 2026-11-16
**Status:** **PARTIAL — code complete and verified locally; production activation is BLOCKED on owner-controlled Supabase Auth changes.**

> This report distinguishes what was **implemented and tested in the repository** from what is
> **actually active in production**. Nothing in the "Owner actions" sections was performed.
> No production Supabase setting, email template, redirect URL, environment variable, account or
> database row was changed. No email was sent. No Gmail delivery was tested.

---

## 1. What was asked, and what was delivered

| Requirement | Status | Evidence |
|---|---|---|
| Keep email + password login working | **DONE** | `loginAction` unchanged in behaviour; 2 new regression tests |
| Keep phone + password login working | **DONE** | `loginWithPhoneAction` unchanged; redirect-outside-try/catch guard still enforced |
| Add email OTP login (send → 6 digits → verify → session → role redirect) | **DONE (code)** | `lib/auth/actions.ts` (`requestEmailOtpAction`, `verifyEmailOtpAction`) |
| Six-digit code entry, resend cooldown, expiry display, useful errors | **DONE** | `components/auth/email-otp-form.tsx`, `lib/auth/otp-rules.ts` |
| No unintended account creation | **DONE** | `shouldCreateUser: false`, asserted by test |
| Role fetched server-side, never from browser | **DONE** | `lib/auth/sign-in-gate.ts` |
| OTP grants no extra privilege | **DONE** | Both credential paths call the *same* gate function |
| No custom plaintext OTP table | **DONE** | Supabase `verifyOtp` only; no migration added |
| No OTP in logs / URLs / localStorage / sessionStorage / console | **DONE** | asserted by test over all five source files |
| Gmail SMTP readiness (no credentials in repo) | **PREPARED, NOT CONFIGURED** | `docs/repair/GMAIL_SMTP_OWNER_SETUP_GUIDE.md` |
| Branded OTP email template (code, expiry, never-share) | **PREPARED, NOT PUBLISHED** | `supabase/templates/otp-signin.html` + `.txt` |
| Auth config audit + recommended production values | **DONE (audit)** | §7 below |

### Honest status summary

| # | Item | Verdict |
|---|---|---|
| 1 | Password login | **WORKING (unchanged)** |
| 2 | Email OTP implemented | **YES (code + 90 tests) — NOT YET USABLE IN PRODUCTION** |
| 3 | Gmail SMTP code readiness | **READY (owner setup required)** |
| 4 | Production SMTP configured | **NO — `smtp_*` are all `null`** |
| 5 | Supabase Auth settings changed | **NO — audit only** |
| 6 | Existing accounts preserved | **YES — 0 touched (and 0 exist)** |
| 7 | Security tests | **PASS (repo-level)** |
| 8 | Typecheck / lint / build / tests | **PASS** |
| 9 | Branch + PR | **`arena/a1a3a8cb-maharani-mart`, PR #136** |
| 10 | Owner manual steps remain | **YES — see §9** |

---

## 2. Why OTP cannot work in production yet (BLOCKED, not "done")

The code is correct, but **three live Auth settings make email OTP unusable today**. All three are
owner-approved production changes and were deliberately **not** made:

1. **`mailer_otp_length = 8`, not 6.** The UI renders 6 boxes by default and GoTrue validates the
   submitted token against the project's length. Until the project is set to 6 (or
   `NEXT_PUBLIC_AUTH_OTP_LENGTH=8` is set), verification fails.
   *Mitigation shipped:* the failure is detected (`configMismatch`), explained to the user in plain
   language, and **does not consume** the attempt budget.
2. **`smtp_host/user/pass/port/sender_name/admin_email` are all `null`.** Supabase's built-in
   email sender is rate-limited and not intended for production; deliverability to Gmail addresses
   is unreliable. Custom SMTP is required before enabling this for real users.
3. **`site_url = http://localhost:3000` and `uri_allow_list = ""`.** Production redirects are not
   configured for the real domain.

Additionally, **`rate_limit_email_sent = 2` per hour** (project-wide) means only two OTP emails can
be sent across the entire app per hour. That is far too low for real use; the recommended value is
30 (§7).

> Because of (1) and (2), the correct verdict for "Gmail delivery works" is **NO**, and for
> "email OTP is production-ready" is **NO**. Claiming otherwise would be false.

---

## 3. Architecture

### 3.1 Files

| File | Change | Purpose |
|---|---|---|
| `lib/auth/otp-rules.ts` | **new** (193 lines) | Pure, testable OTP rules: length/expiry resolution, normalisation, cooldown, masking, error classification |
| `lib/auth/sign-in-gate.ts` | **new** (120 lines) | Single authorization gate shared by password **and** OTP |
| `lib/auth/actions.ts` | **modified** | `requestEmailOtpAction`, `verifyEmailOtpAction`; both password paths now use the shared gate |
| `lib/auth/helpers.ts` | **modified** | `OtpFormState` type; `account_inactive` / `account_suspended` error codes |
| `lib/supabase/server.ts` | **modified** | `auth: { flowType: 'implicit' }` — see §3.4 |
| `components/auth/email-otp-form.tsx` | **new** (330 lines) | Two-stage OTP UI |
| `components/auth/login-form.tsx` | **modified** | Third tab ("Code"); password + phone tabs untouched |
| `supabase/templates/otp-signin.html` | **new** | Branded HTML template, **not published** |
| `supabase/templates/otp-signin.txt` | **new** | Plain-text alternative, **not published** |

No migration was added. No database object was created, altered or dropped.

### 3.2 Flow

```
Browser                        Server Action                    Supabase Auth
───────                        ─────────────                    ─────────────
email + [Send code]  ────────► requestEmailOtpAction
                                 signInWithOtp(shouldCreateUser:false) ──► GoTrue
                                 set httpOnly cookies (email, sentAt)  ◄── 204
                                 returns GENERIC "code on its way"
code (6 digits)      ────────► verifyEmailOtpAction
                                 read email from httpOnly cookie (not form)
                                 verifyOtp({email, token, type:'email'}) ──► GoTrue
                                                               ◄── session (cookies)
                                 assertSignInAllowed(userId)   ◄── profiles / retailers
                                 clear pending cookies
                                 redirect(homeForRole(role))
```

### 3.3 Security decisions

| Decision | Reason |
|---|---|
| `shouldCreateUser: false` | The login screen must never mint an account. New retailers use `/register-retailer`; sellers are invitation-only. |
| Pending email in an **httpOnly, sameSite=lax, secure-in-prod** cookie | Not readable or forgeable by client JS; survives the two-step flow; never appears in a URL. A hidden form field would be attacker-controlled; `localStorage` would be readable by any XSS. |
| Code length **not** taken from the request | A caller must not be able to influence how the token is normalised. |
| Generic copy for the send step | The same sentence is returned for unknown, deactivated and suspended addresses, so the endpoint cannot enumerate accounts. Rate-limit messages are exempt because they depend on volume, not on the account. |
| Real reason shown only **after** a valid credential | Deactivated/suspended messages appear only once Supabase has already accepted the password or the code. At that point the attacker possesses valid credentials, so the message is not an oracle — and refusing silently would leave a legitimately suspended retailer unable to understand why they cannot get in. |
| Server-set cooldown + GoTrue limits | The cookie is clearable, so the 60-second cooldown is UX only. `rate_limit_email_sent` / `rate_limit_verify` / `rate_limit_otp` are the real limits. |
| Attempt counter (5) | Defence in depth; also stops a "guess 6 digits" loop from consuming the hourly verify budget. Refunded on a length-mismatch (our bug, not the user's). |
| Verify error → new session only | `verifyOtp` *replaces* the session; it never runs alongside an existing one, so no duplicate/conflicting session is created. |

### 3.4 Why `flowType: 'implicit'` was pinned

With `flowType: 'pkce'` (the `@supabase/ssr` default), `signInWithOtp()` also mints a
`sb-<ref>-auth-token-code-verifier` cookie and sends `{{ .ConfirmationURL }}` — a magic **link** —
in the email. The numeric `{{ .Token }}` then merely has to satisfy a later `verifyOtp()`.

Two concrete problems for a code-based login:

1. **Reliability / rate limit.** The login would depend on a second cookie surviving round-trips.
   A stale or missing verifier makes `verifyOtp()` fail, and the user has only **30 verify
   attempts per hour**. `verifyOtp()` does not need PKCE: it POSTs `email + token` and receives the
   session directly (verified in `auth-js@2.110.7`, `GoTrueClient.verifyOtp`).
2. **Setup surface.** Under PKCE the *OTP/Auth* template and the *Magic Link* template must differ,
   doubling what the owner has to configure correctly.

With the implicit flow the same **Magic Link** template can carry the code and no verifier cookie
is involved. Password and phone login never read `flowType`, so they are unaffected.
Covered by `tests/supabase-server-client.test.ts` (still green).

---

## 4. The one shared authorization gate

Before this change, `pending_approval` retailers were redirected to `/pending-approval` only by
`middleware.ts` and `requireUser()`. A Server Action can be invoked directly, so a second
credential path that skipped that check would have widened the attack surface.

`lib/auth/sign-in-gate.ts` now encodes the *same* rules for **both** paths:

| Condition | OTP | Password | Outcome |
|---|---|---|---|
| `profiles.is_active = false` | ✅ | ✅ | session destroyed (`signOut`), refused |
| no `profiles` row | ✅ | ✅ | session destroyed, refused |
| `retailers.status = 'suspended'` | ✅ | ✅ | session destroyed, refused |
| `retailers.status ≠ 'active'` | ✅ | ✅ | allowed, but routed to `/pending-approval` |
| otherwise | ✅ | ✅ | `safeRedirectPath(...) ?? homeForRole(role)` |

The role is **always** read from `profiles` server-side, keyed by the authenticated user id.
No browser-supplied value is trusted anywhere in this flow.

---

## 5. UI

- **Three tabs**: `Mobile Number` (default), `Email` (password), `Code` (OTP). Existing users see
  exactly what they saw before.
- **One accessible code input**, rendered as N decorative `aria-hidden` boxes. One input means one
  paste target, one form value (`token`), native `autocomplete="one-time-code"`, and no focus-juggling.
- **Paste-tolerant**: spaces, dashes and NBSP are stripped; only digits of the exact length are accepted.
- **Resend countdown** (`mm:ss`) driven by the server's `sentAt`, so a reload cannot reset it.
- **No double submit**: `pending` from `useFormStatus` disables both buttons while an action runs.
- **Expiry + never-share** copy is visible on the code screen.
- **Accessible**: labelled inputs, `aria-pressed` tabs, `aria-invalid` on a rejected code,
  `role="alert"` for errors, `aria-live` on the countdown button.

Tests: 19 component tests in `tests/auth-otp-ui.test.tsx` (jsdom).

---

## 6. Verification

| Gate | Command | Result |
|---|---|---|
| Typecheck | `npx tsc --noEmit` | **PASS** (0 errors) |
| Lint | `npx eslint .` | **PASS** (0 errors, 0 warnings in touched files) |
| Full suite | `npx vitest run` | **232 files / 3567 tests PASS** |
| Build | `npx next build` | **PASS** |
| Baseline (before) | — | 229 files / 3493 tests |

**74 new tests, 0 regressions:**

| File | Tests | Scope |
|---|---|---|
| `tests/auth-otp.test.ts` | 35 | Server actions, security matrix |
| `tests/auth-otp-ui.test.tsx` | 19 | Component behaviour |
| `tests/auth-otp-rules.test.ts` | 20 | Pure rules |
| `tests/otp-email-template.test.ts` | 16 | Template correctness |

### Two pre-existing guards were updated (deliberately)

| Test | What changed | Why it is not a weakening |
|---|---|---|
| `tests/auth-login.test.ts` → "verifies passwords only through Supabase Auth" | Removed the blanket ban on `signInWithOtp`/`verifyOtp` | The guard's intent is *no custom credential verification*. It now forbids `bcrypt`/`argon2`/`scrypt`/`timingSafeEqual`, still bans non-Supabase providers, and asserts that if `verifyOtp` exists it **must** be `supabase.auth.verifyOtp(` with no local OTP store. |
| `tests/auth-login.test.ts` → "stores no plain-text password…" | Regex now matches credential storage (`password_hash`, `plaintext_pass`), not the bare word "plaintext" | The word appears legitimately in a design comment that states no such store exists. No behaviour changed. |
| `tests/server-action-surface.test.ts` | Two actions added to `PUBLIC_ALLOWLIST` with justification | This list is the repository's designed mechanism for "public by design" flows; unauthenticated login endpoints have no session to guard with. |

### Also removed (dead code)

`isEmailOtpAvailableAction` — an exported Server Action that enumerated Auth users with the
service-role client. It was never called, so removal changes no behaviour; it also tightened the
attack surface (every exported action in a `'use server'` module is a reachable endpoint).

---

## 7. Live Auth configuration audit

Read on 2026-11-16 from project `fhrmsrumsraprvutrpeo` (read-only connector). **Nothing below was changed.**

| Setting | Live value | Recommended production value | Why | Owner-approved change? |
|---|---|---|---|---|
| `site_url` | `http://localhost:3000` | `https://<production-domain>` | Password-reset / confirmation / OTP links currently point at localhost | **YES — required** |
| `uri_allow_list` | `""` (empty) | `https://<production-domain>/auth/callback,https://<production-domain>/reset-password` | Explicit allowlist; **never** a wildcard | **YES — required** |
| `mailer_otp_length` | **8** | **6** | Matches the entry UI and the product spec | **YES — required for OTP** |
| `mailer_otp_exp` | `3600` (60 min) | `600` (10 min) | A sign-in code should not live an hour | **YES — recommended** |
| `rate_limit_email_sent` | **2 / hour** | `30 / hour` | 2 per hour is *project-wide* and makes OTP unusable | **YES — required for OTP** |
| `smtp_host / user / pass / port` | **all `null`** | Gmail SMTP (see guide) | Built-in sender is rate-limited and poor for deliverability | **YES — required** |
| `smtp_admin_email` | `null` | The Gmail sender address | Sender/bounce identity | **YES — required** |
| `smtp_sender_name` | `null` | `Maharani Traders` | Branding | **YES — recommended** |
| `smtp_port` | `null` | `465` (implicit TLS/SSL) | Simplest reliable option | **YES — required** |
| `mailer_autoconfirm` | `false` | `false` (keep) | Email ownership must stay verified | No |
| `disable_signup` | `false` | `false` (keep) | Retailer self-registration is required | No |
| `external_email_enabled` | `true` | `true` (keep) | Both email methods need it | No |
| `external_phone_enabled` | `false` | `false` (keep) | Phone login maps to email, no SMS needed | No |
| `external_email_magic_link_disabled` | `false` | `false` (keep) | Must stay enabled for the OTP send call | No |
| `security_captcha_enabled` | `false` | `true` (recommended) | Bot protection on public OTP endpoint | **YES — recommended** |
| `password_min_length` | `6` | `8` | Weak for admin accounts | **YES — recommended** |
| `password_hibp_enabled` | `false` | `true` (recommended) | Blocks breached passwords | **YES — recommended** |
| `mfa_totp_enroll/verify` | `true` | `true` (keep) | Required for privileged MFA (§8) | No |
| `mfa_max_enrolled_factors` | `10` | `10` (keep) | — | No |
| `sessions_single_per_user` | `false` | `false` (keep) | Multiple devices are expected | No |
| `sessions_timebox` | `0` | `0` (keep) | — | No |
| `refresh_token_rotation_enabled` | `true` | `true` (keep) | Detects token replay | No |
| `mailer_templates_reauthentication_content` | `"…{{ .Token }}…"` | (reuse text) | **Already sends a code** — best basis for the OTP template (§10) | No |

**Templates:** every `mailer_templates_custom_contents` flag is `false` (Supabase defaults). The
**Magic Link** template currently mails `{{ .ConfirmationURL }}` — a *link*, no code — which is why
the OTP template must be published before OTP is useful.

---

## 8. MFA audit for privileged accounts

**Finding: MFA is available but exercised by nobody — there are no accounts at all.**

| Check | Result |
|---|---|
| `auth.users` rows | **0** |
| `public.profiles` rows | **0** |
| `auth.mfa_factors` rows (all) | **0** |
| `auth.mfa_factors` rows (`status = 'verified'`) | **0** |
| `auth.mfa_factors` table exists | yes |
| `mfa_totp_enroll_enabled` / `mfa_totp_verify_enabled` | `true` / `true` |
| `mfa_phone_*`, `mfa_web_authn_*`, `passkey_enabled` | `false` |
| `mfa_allow_low_aal` | `false` |

**Interpretation.** There is no Super Admin or Admin account in this database, so there is no
privileged credential to protect *yet*, and nothing to preserve (§ "accounts preserved" = trivially
true; **0 accounts were modified**). When the first Super Admin is created (see
`docs/repair/SUPER_ADMIN_FIRST_BOOTSTRAP_GUIDE.md`), they must enrol a TOTP factor **at creation
time**, before the account is used for anything.

**Email OTP is not MFA.** A password and an email code are two factors only if they are different
*factor types* — but both are something-you-know delivered over a channel an attacker who controls
the mailbox already owns. It raises the cost of credential stuffing; it does not stop a compromised
mailbox. Privileged access therefore needs **TOTP** (`mfa.enroll({factorType:'totp'})` + challenge),
and optionally single-session enforcement.

**Not implemented (deliberately).** An AAL2 gate on `/admin` would lock out every account that has
not enrolled TOTP, and there are currently **zero** accounts — enabling it today would make admin
access impossible. Recommended order:

1. Create the first Super Admin (bootstrap guide).
2. Enrol TOTP for it and verify a challenge succeeds end-to-end.
3. **Then** add the AAL2 gate to `/admin/*` (middleware + `requireUser`), as a separate reviewed change.

Recommended target settings once step 2 is verified: `mfa_max_enrolled_factors = 2` (TOTP + backup),
`sessions_single_per_user = false` (keep, so recovery is possible), and `mfa_allow_low_aal = false` (keep).

---

## 9. Owner actions (in order)

Full click-by-click instructions: **`docs/repair/GMAIL_SMTP_OWNER_SETUP_GUIDE.md`**.
Template source: **`supabase/templates/otp-signin.html`** / **`.txt`** (§10).

| # | Action | Where | Blocks |
|---|---|---|---|
| 1 | Set `site_url` to the production domain | Auth → URL Configuration | all email links |
| 2 | Set the redirect allowlist (exact paths, **no wildcards**) | Auth → URL Configuration | reset / confirm |
| 3 | Set `mailer_otp_length = 6` | Auth → Providers → Email | **OTP verify** |
| 4 | Set `mailer_otp_exp = 600` | Auth → Providers → Email | OTP hygiene |
| 5 | Enable custom SMTP with Gmail + App Password | Auth → SMTP | **OTP delivery** |
| 6 | Set `smtp_sender_name = Maharani Traders` | Auth → SMTP | branding |
| 7 | Raise `rate_limit_email_sent` to ~30/hour | Auth → Rate Limits | **OTP usable at all** |
| 8 | Replace the **Magic Link** template body with the prepared HTML + set subject | Auth → Email Templates | **OTP email content** |
| 9 | Enable CAPTCHA (hCaptcha/Turnstile) | Auth → Security | abuse |
| 10 | Raise `password_min_length` to 8, enable HIBP check | Auth → Providers → Email | admin password strength |
| 11 | Send **one** real OTP to a controlled mailbox and complete sign-in | the live site | **final proof** |

**Approve Gmail SMTP is a manual, owner-only step.** Never paste the App Password into this repo,
an issue, a chat, a screenshot, or an environment variable read by the frontend. It belongs **only**
in the Supabase Auth SMTP panel.

**Rollback:** every setting above can be reverted individually in the same panel. Do not combine
steps 3–8 with anything else, so a failure is unambiguous.

---

## 10. The prepared email template

`supabase/templates/otp-signin.html` (+ `.txt`). **Prepared only — not published.**

- Real code: `{{ .Token }}` (not `{{ .ConfirmationURL }}`, no link at all).
- Expiry from config: `{{ .OTPExpiryMinutes }}` — it can never disagree with `mailer_otp_exp`.
- Never-share warning, plus "if you didn't request this, ignore it".
- Mobile-first: fluid 560px container, `width=device-width`, 34–40px code, ≥16px body text.
- Tables + inline CSS (Gmail/Outlook safe); no flex/grid; preheader for the inbox preview.
- Plain-text alternative included.

**Template variable note.** The stock **Magic Link** template renders `{{ .Token }}` without issue,
so `{{ .Token }}` is the safe choice. If Supabase reports *"OTPExpiryMinutes is not a valid
property"*, replace `{{ .OTPExpiryMinutes }}` with the literal number matching `mailer_otp_exp`
(e.g. `10`) — see the guide, step 8.

---

## 11. Known limitations

1. **Not production-usable** until the §9 steps are done. This is the headline verdict.
2. **Resend cooldown is per-browser.** It lives in an httpOnly cookie; clearing cookies resets the
   countdown. GoTrue's server-side limits remain authoritative.
3. **Length mismatch is detectable but not fixable from the app.** The UI explains it and refunds
   the attempt; only the owner can change `mailer_otp_length`.
4. **No AAL2 gate for admins** — see §8 for why it must follow, not precede, the first enrolment.
5. **`/login` now offers three tabs**; on very narrow screens the labels wrap but remain legible.
6. No accessibility audit beyond the automated assertions in `tests/auth-otp-ui.test.tsx`.

---

## 12. What was NOT done (explicitly)

- No production Supabase Auth setting changed.
- No email template published or modified in production.
- No redirect URL or site URL changed.
- No SMTP credential entered, stored, or requested.
- No production migration applied (migration history still ends at `0103`).
- No user account created, modified or deleted.
- No environment variable changed; nothing deployed; PR #136 **not** merged.
- Password login **not** disabled or altered in behaviour.
- No Gmail delivery claimed or tested.

---

## Appendix A — Verification commands

```bash
npx tsc --noEmit                       # PASS
npx eslint .                           # PASS
npx vitest run                         # 232 files / 3567 tests PASS
npx next build                         # PASS

# The new suites only:
npx vitest run tests/auth-otp.test.ts \
               tests/auth-otp-ui.test.tsx \
               tests/auth-otp-rules.test.ts \
               tests/otp-email-template.test.ts   # 90 tests PASS
```

## Appendix B — Environment variables (optional, all safe to leave unset)

| Variable | Default | Purpose |
|---|---|---|
| `NEXT_PUBLIC_AUTH_OTP_LENGTH` | `6` | Boxes rendered; must equal `mailer_otp_length`. Set to `8` to bridge the current live value. |
| `NEXT_PUBLIC_AUTH_OTP_EXPIRY_MINUTES` | `60` | Label only; must equal `mailer_otp_exp / 60`. Defaults to the current live value. |

These are public, non-secret display values. No SMTP or API secret is ever exposed to the client.
