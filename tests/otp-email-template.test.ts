import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * OTP EMAIL TEMPLATE — correctness gate.
 *
 * These templates are PREPARED IN THE REPO ONLY. Nothing here publishes them:
 * changing a Supabase Auth email template is an owner action (see
 * docs/repair/GMAIL_SMTP_OWNER_SETUP_GUIDE.md). These tests make sure that the
 * moment the owner does paste one in, it is already correct — a template that
 * mails a magic LINK, or an expiry that disagrees with the Auth project, would
 * silently break sign-in for everyone.
 */

const root = join(__dirname, '..');
const html = readFileSync(join(root, 'supabase/templates/otp-signin.html'), 'utf8');
const text = readFileSync(join(root, 'supabase/templates/otp-signin.txt'), 'utf8');

describe('OTP email template — sends a CODE, not a link', () => {
  it.each([
    ['html', () => html],
    ['plain text', () => text],
  ])('%s version contains the real {{ .Token }} placeholder', (_name, read) => {
    expect(read()).toContain('{{ .Token }}');
  });

  it.each([
    ['html', () => html],
    ['plain text', () => text],
  ])('%s version contains no magic link', (_name, read) => {
    const source = read();
    // The Magic-Link template ships {{ .ConfirmationURL }}; this one must not.
    expect(source).not.toContain('{{ .ConfirmationURL }}');
    // No clickable link at all: the code must be typed, not followed. (The
    // xmlns="http://www.w3.org/..." declarations above are XML boilerplate,
    // not links, so match real anchors and href attributes instead.)
    expect(source).not.toMatch(/<a\s[^>]*href=/i);
    expect(source).not.toMatch(/href\s*=\s*["']https?:/i);
    expect(source).not.toMatch(/ConfirmationURL|SiteURL|RedirectTo/);
  });
});

describe('OTP email template — expiry matches the Auth project', () => {
  it.each([
    ['html', () => html],
    ['plain text', () => text],
  ])('%s version states the expiry from config, not a hardcoded number', (_name, read) => {
    const source = read();
    expect(source).toMatch(/expires in \{\{ \.OTPExpiryMinutes \}\}/i);
    // A literal "expires in 10 minutes" would drift from mailer_otp_exp.
    expect(source).not.toMatch(/expires in \d+\s*minutes/i);
  });
});

describe('OTP email template — never-share warning', () => {
  it.each([
    ['html', () => html],
    ['plain text', () => text],
  ])('%s version warns the user not to share the code', (_name, read) => {
    const source = read().toLowerCase();
    expect(source).toMatch(/never share/);
    expect(source).toMatch(/will never ask/);
  });

  it('tells the user what to do if they did not request it', () => {
    expect(html.toLowerCase()).toMatch(/didn&rsquo;t try to sign in|didn't try to sign in/);
    expect(text.toLowerCase()).toMatch(/didn't try to sign in/);
  });
});

describe('OTP email template — mobile and client compatibility', () => {
  it('is mobile responsive with a fluid container', () => {
    expect(html).toContain('width=device-width');
    expect(html).toContain('max-width: 560px');
    expect(html).toMatch(/@media only screen and \(max-width: 600px\)/);
    expect(html).toMatch(/width: 100% !important/);
  });

  it('is laid out with tables and inline styles (Outlook/Gmail safe)', () => {
    expect(html).toMatch(/<table role="presentation"/);
    expect(html).not.toMatch(/display:\s*flex/);
    expect(html).not.toMatch(/display:\s*grid/);
  });

  it('declares a preheader so the inbox preview is not raw markup', () => {
    expect(html).toMatch(/mso-hide:all/);
    expect(html).toMatch(/one-time sign-in code/i);
  });

  it('carries the brand name', () => {
    expect(html).toContain('Maharani Traders');
    expect(text).toContain('MAHARANI TRADERS');
  });

  it('has a plain-text alternative for clients that block HTML', () => {
    expect(text.trim().length).toBeGreaterThan(100);
    expect(text).not.toMatch(/<[a-z][\s\S]*>/i);
  });
});

describe('OTP email template — no secrets in the template itself', () => {
  it('contains no SMTP credentials, API keys or real addresses', () => {
    for (const source of [html, text]) {
      expect(source).not.toMatch(/smtp|app.?password|api[_-]?key|service_role/i);
      expect(source).not.toMatch(/@gmail\.com|@maharanitraders/i);
    }
  });

  it('is not wired into any code path (prepare-only)', () => {
    const actions = readFileSync(join(root, 'lib/auth/actions.ts'), 'utf8');
    expect(actions).not.toMatch(/otp-signin\.(html|txt)/);
  });
});
