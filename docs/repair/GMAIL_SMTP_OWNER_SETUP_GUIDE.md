# Gmail SMTP & Email OTP — Owner Setup Guide

**For:** the Maharani Traders owner / Super Admin
**Goal:** make email sign-in codes actually arrive in customers' inboxes
**Time:** about 30–40 minutes
**Risk:** low — every step is reversible, and nothing here touches your data or accounts

> **Read this first.** You do **not** need to give anyone your password. Never paste the Google
> App Password into WhatsApp, email, a chat with an AI assistant, a screenshot, GitHub, or any
> website other than the official Supabase settings page. If anyone asks you for it, they are
> trying to take over your email — refuse.

---

## What you will end up with

- Sign-in codes sent through **your own Gmail address** instead of Supabase's shared test sender
  (which is heavily rate-limited and often lands in spam).
- A branded code email with your shop name.
- Both **password** and **code** sign-in working on the live site.

**What still works while you do this:** password login and phone login are unaffected at every
step. If you stop halfway, customers can still sign in with a password.

---

## Part 1 — Before you touch Supabase (10 minutes)

### 1.1 Decide the sender address

You must use a **real Gmail or Google Workspace address that you own**. Which one is your decision —
we have deliberately not assumed or invented one.

- ✅ Something like your existing business inbox (`…@gmail.com`, or your own domain via Google Workspace).
- ❌ Do **not** use a personal address you would not want customers to see.
- ❌ Do **not** use a shared/staff mailbox that several people can log into.

Write it down on paper. You will type it into Supabase, nowhere else.

### 1.2 Turn on 2-Step Verification

Gmail requires this before it will issue an App Password.

1. Open <https://myaccount.google.com/security>
2. Under **How you sign in to Google**, click **2-Step Verification** → **Turn on**
3. Finish the phone prompt.

> If you cannot enable 2-Step Verification on this account, **stop**. Ask your IT person. There is
> no supported way to use Gmail SMTP without it.

### 1.3 Create an App Password

1. Open <https://myaccount.google.com/apppasswords>
   (if the page says it is unavailable, 2-Step Verification is not fully enabled — go back to 1.2)
2. Name it: `Maharani Traders Supabase`
3. Click **Create**
4. Google shows a **16-character password** in four groups, e.g. `abcd efgh ijkl mnop`

**Handle it like this:**
- Copy it **without the spaces** → `abcdefghijklmnop`
- Keep it on screen for the next 10 minutes only, or write it on paper
- **Do not** email it, screenshot it, or paste it into any chat
- When you close the dialog you cannot see it again (you can always create a new one)

**Important:** this App Password is *not* your Gmail password. If you ever need to revoke it,
delete it on the same page and email sending stops immediately — that is your panic button.

---

## Part 2 — Supabase: SMTP (10 minutes)

1. Open <https://supabase.com/dashboard/project/fhrmsrumsraprvutrpeo>
   (project **Maharani-mart**, ref `fhrmsrumsraprvutrpeo`)
2. Left sidebar → **Authentication**
3. Click **Emails** (some versions: *Auth → Settings*, then scroll to **SMTP Settings**)
4. Find **SMTP Settings** and toggle **Enable Custom SMTP** on
5. Fill in exactly:

| Field | Value |
|---|---|
| Host | `smtp.gmail.com` |
| Port | `465` |
| Username | *your full Gmail address* (e.g. `yourname@gmail.com`) |
| Password | *the 16-character App Password, no spaces* |
| Sender email | *the same Gmail address* |
| Sender name | `Maharani Traders` |

> **If port 465 is refused**, use port `587` with **TLS/STARTTLS** instead. Both are supported;
> 465 (implicit TLS/SSL) is normally the more reliable of the two with Gmail.

6. Click **Save**

### If it errors

| Message | Meaning | Fix |
|---|---|---|
| `535 Authentication failed` | Wrong App Password, or you used your Gmail password | Create a **new** App Password and retype it (no spaces) |
| `Connection timed out` / `ETIMEDOUT` | Port blocked | Try port `587` with TLS |
| `Sender address rejected` | Sender email ≠ username | Make the two fields identical |
| `Username and Password required` | Fields empty after saving | Re-enter both |

**Gmail sending limits:** a normal Gmail account can send roughly **500 messages per day**. That is
plenty for sign-in codes for a shop of this size. If you outgrow it, move to Google Workspace or a
transactional provider.

---

## Part 3 — Supabase: OTP settings (5 minutes)

Still in **Authentication → Emails** (or *Providers → Email*):

| Setting | Set it to | Why |
|---|---|---|
| **Email OTP Length** | `6` | The website shows six boxes. **The live project is currently set to 8, so code sign-in fails until this is 6.** |
| **Email OTP Expiry** | `600` seconds (10 minutes) | Currently 60 minutes, which is far too long for a sign-in code |

If you would rather keep the length at 8 for now, set the Vercel environment variable
`NEXT_PUBLIC_AUTH_OTP_LENGTH=8` instead — but **6 is the recommended value**.

Then go to **Authentication → Rate Limits**:

| Setting | Current | Set to | Why |
|---|---|---|---|
| **Rate limit for sending emails** | **2 per hour** | `30 per hour` | 2 per hour is app-wide: only two customers could sign in by code each hour |
| Rate limit for token verifications | 30 | keep 30 | fine |
| Rate limit for OTP | 30 | keep 30 | fine |

> **Reality check:** while this is 2/hour, email OTP is effectively unusable. This single number is
> the most important setting on this page.

---

## Part 4 — Supabase: the code email template (10 minutes)

Right now the "Magic Link" email contains a **clickable link**, not a code. For code sign-in it must
contain the code.

1. Still in **Authentication → Emails** → **Email Templates**
2. Select the **Magic Link** template
3. **Subject**, set to:
   ```
   {{ .Token }} is your Maharani Traders sign-in code
   ```
4. **Body**: open `supabase/templates/otp-signin.html` from this repository, select all, copy it,
   and paste it over the entire existing body.
5. **Save**

### About the template

- `{{ .Token }}` is the real code Supabase generates. Do not change it.
- `{{ .OTPExpiryMinutes }}` prints the expiry you set in Part 3.
- There is deliberately **no link** in the email — the customer types the code into the website.
- The email already includes the "never share this code" warning.

**If saving fails with** *"OTPExpiryMinutes is not a valid variable"* **or the code shows blank**:
replace `{{ .OTPExpiryMinutes }}` with the literal number matching your expiry — with 600 seconds
use `10`. Everything else stays the same.

**Optional but recommended:** after this works, put the same body into the **Reauthentication**
template too (it already sends `{{ .Token }}`).

---

## Part 5 — URL configuration (5 minutes)

Supabase needs to know your real domain, otherwise links in password-reset and confirmation emails
point at `localhost`.

1. **Authentication → URL Configuration**
2. **Site URL**: your live domain, e.g. `https://maharanitraders.vercel.app`
   (use the exact production domain from your Vercel project — the current value is
   `http://localhost:3000`, which is wrong)
3. **Redirect URLs** — add these exact entries, one per line:

   ```
   https://<your-domain>/auth/callback
   https://<your-domain>/reset-password
   ```

   Replace `<your-domain>` with your real domain. **Keep `/auth/callback` — password reset and email
   confirmation depend on it.**

> ⚠️ **Never add a wildcard** such as `https://*.vercel.app` or `*`. A wildcard lets an attacker
> redirect your users (and their tokens) to any site they control. Add only the exact URLs above.

4. **Save**

---

## Part 6 — Test it (5 minutes — do not skip)

**Do not tell customers email sign-in works until this passes.**

1. Open the live site → **Sign in** → **Code** tab
2. Enter a **test mailbox you personally control** (not a customer's)
3. Click **Send code**
4. Check the inbox:
   - [ ] The email arrived (and looks correctly branded)
   - [ ] It shows a **6-digit number**
   - [ ] It says the code expires in 10 minutes
   - [ ] It contains the "never share" warning
   - [ ] It contains **no link** asking you to click
5. Type the code into the website
6. - [ ] You land on the correct page for that account
7. Now confirm nothing else broke:
   - [ ] Sign out, then sign in with **email + password** — works
   - [ ] Sign in with **mobile + password** — works
   - [ ] **Forgot password** sends an email whose link opens the live domain
8. Try the abuse cases:
   - [ ] Request a code twice quickly → the second is refused with a wait message
   - [ ] Enter a wrong code → you get a plain error, not a hint about the account
   - [ ] Enter a wrong code 5 times → you are asked to wait

**If any box is unchecked, do not announce it. Note which step failed — each maps to one part above.**

### If the email never arrives

| Check | Look at |
|---|---|
| Supabase logs | Authentication → **Logs** → filter *email* |
| Was it sent at all? | A "rate limit exceeded" entry means Part 3's rate limit is still 2/hour |
| Is the address registered? | Code sign-in **never creates accounts**. An unknown address is silently ignored by design. Test with an account that already exists. |
| Spam folder | Gmail may still filter a first-time sender. **Mark "not spam".** |
| App Password revoked | Google Account → Security → App Passwords |

---

## Part 7 — Security hardening (optional, recommended)

**Authentication → Providers → Email**

| Setting | Change to | Why |
|---|---|---|
| Minimum password length | `8` | 6 is weak for an admin account |
| Prevent use of leaked passwords (HIBP) | on | Rejects passwords already in breach dumps |

**Authentication → Security** → enable **CAPTCHA** (hCaptcha or Cloudflare Turnstile) if you have
keys. This protects the public "send code" endpoint from bots.

---

## Part 8 — Privileged accounts need more than email codes

Email codes and passwords are **not** two-factor authentication: both are secrets sent to, or
remembered by, the same person, and a compromised mailbox defeats both.

For Super Admin and Admin accounts:

1. Create the account (see `docs/repair/SUPER_ADMIN_FIRST_BOOTSTRAP_GUIDE.md`).
2. Immediately enrol an **authenticator app** (TOTP — Google Authenticator, Authy, 1Password).
   The project already has TOTP enabled, so no Supabase change is needed.
3. Only after that works, ask your developer to enforce TOTP on `/admin` routes.

> There are currently **no accounts at all** in this database, so this applies to the very first
> admin you create. Enrolling first is easy; retrofitting it later is not.

---

## Part 9 — Rollback

Everything here is reversible, one setting at a time:

| To undo | Do this |
|---|---|
| Stop using Gmail | Authentication → Emails → turn **Enable Custom SMTP** off |
| Revoke the App Password | Google Account → Security → App Passwords → delete it (email stops instantly) |
| Revert the code email body | Authentication → Emails → Email Templates → **Reset to default** |
| Revert OTP length / expiry | Set them back to `8` / `3600` |
| Revert the URL allowlist | Remove the added entries (keep the Site URL correct) |

Nothing here deletes users, orders or data.

---

## Part 10 — What you do NOT need to do

- ❌ Do not share your Gmail password with anyone.
- ❌ Do not send the App Password to your developer.
- ❌ Do not add SMTP credentials to Vercel, `.env` files, or this repository. **They belong only in
  the Supabase Auth SMTP panel.**
- ❌ Do not add wildcard redirect URLs.
- ❌ Do not disable password login — it must keep working for everyone.

---

## Quick reference

| Item | Value |
|---|---|
| Supabase project | `Maharani-mart` (`fhrmsrumsraprvutrpeo`) |
| SMTP host | `smtp.gmail.com` |
| SMTP port | `465` (fallback `587` + TLS) |
| SMTP username | your full Gmail address |
| SMTP password | 16-character Google **App Password** (no spaces) |
| Sender name | `Maharani Traders` |
| OTP length | `6` |
| OTP expiry | `600` seconds |
| Email rate limit | `30` per hour |
| Template file | `supabase/templates/otp-signin.html` |
| Template subject | `{{ .Token }} is your Maharani Traders sign-in code` |

**Success = Part 6 fully ticked.** Until then, email code sign-in is *prepared*, not *working*.
