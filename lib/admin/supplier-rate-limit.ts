import 'server-only';

import { createHmac, randomBytes } from 'node:crypto';

/**
 * Abuse protection for the public supplier application form.
 *
 * DESIGN
 * ------
 * Durable path (migration 0060, unapplied): Postgres atomic upsert via
 * `consume_supplier_application_rate_limit`, buckets keyed by HMAC-SHA-256
 * (below). Fallback: a BOUNDED in-memory limiter (per process only — it is
 * not, and must never be described as, a distributed rate limiter).
 *
 * F1 — KEYED HASHES. Keys were plain SHA-256 of predictable phone/IP
 * values: anyone could compute a victim's bucket hash offline and, since
 * the RPC is anon-callable, burn that bucket directly. Keys are now
 * HMAC-SHA-256 under a server-only key, following the repo's delivery-OTP
 * precedent (lib/delivery/otp.ts):
 *   - `SUPPLIER_RATE_LIMIT_SECRET` (>= 32 chars) when configured, else
 *   - a domain-separated key derived from SUPABASE_SERVICE_ROLE_KEY
 *     (already a required server-only secret; the key itself is never
 *     used as the MAC key directly).
 * Without either, key derivation FAILS — this module never falls back to
 * predictable unsalted hashes. In that state submissions use the
 * in-memory fallback keyed with an ephemeral per-process random salt
 * (privacy-preserving within the process, useless across processes —
 * exactly the fallback's documented scope).
 * RESIDUAL (stated plainly): anon can still call the RPC with arbitrary
 * invented 64-hex keys and create counter rows (bounded by the 0060
 * per-bucket cleanup + the apply-time retention task in the proposal).
 * What they can no longer do is compute or collide with a *real*
 * supplier's bucket without the secret. Rotating the secret invalidates
 * all existing buckets (counters restart) unless a dual-key window is
 * implemented — for a rate limiter that is an acceptable, documented
 * trade-off; provision the secret in the deployment environment only,
 * never in source, client bundles, logs or the database.
 *
 * Buckets (checked client-first, see F7 note): client 10/60min,
 * phone 3/10min. Client identity = first `x-forwarded-for` hop
 * (platform-set convention per lib/mobile/rate-limit.ts) used ONLY as a
 * hashed limiting bucket — never as a trusted identity. Production proxy
 * trust remains UNVERIFIED from local configuration.
 *
 * F7 — ORDERING: the client bucket is consumed first so a client-level
 * rejection no longer burns the caller's phone quota. The two RPC calls
 * are NOT transactional: if the phone check then rejects, one client
 * token was consumed. That residual is unavoidable without a combined
 * RPC and is preferable to the reverse (phone quota is the scarcer,
 * identity-bound resource).
 *
 * FAILURE BEHAVIOUR (F3/F5/F6): RPC unavailable/throwing/malformed →
 * fail-open to the bounded in-memory limiter (registration must not die
 * because an unapplied hardening migration is missing). Counters in the
 * two layers are independent, so during intermittent failures the
 * effective allowance can be up to DB-limit + memory-limit per instance
 * — a strict global quota is NOT claimed in that state. Warnings are
 * throttled to one per minute per process and contain no identifiers.
 */

export const SUPPLIER_PHONE_LIMIT = { limit: 3, windowSeconds: 600 } as const;
export const SUPPLIER_CLIENT_LIMIT = { limit: 10, windowSeconds: 3600 } as const;

// ---------------------------------------------------------------------------
// Key derivation (F1)
// ---------------------------------------------------------------------------

/** Domain-separated HMAC key from raw secret material. Pure/testable. */
export function deriveLimiterKey(secretMaterial: string): Buffer {
  return createHmac('sha256', secretMaterial).update('maharani:supplier-rate-limit:v1', 'utf8').digest();
}

/** HMAC-SHA-256 bucket key for a normalized identifier. Pure/testable. */
export function hmacLimiterKey(kind: 'phone' | 'client', value: string, key: Buffer): string {
  return createHmac('sha256', key)
    .update(`supplier-app:v1:${kind}:${value}`, 'utf8')
    .digest('hex');
}

export type LimiterKeySource = 'dedicated' | 'service-derived' | 'invalid-config' | 'unavailable';

/**
 * Key-source selection (audit N4). The cases are deliberately distinct:
 *   dedicated secret present + valid (>= 32 chars)  -> 'dedicated'
 *   dedicated secret present but INVALID            -> 'invalid-config'
 *     (never silently falls through to a different key source: two
 *     instances with inconsistent env would otherwise pick different
 *     keys and silently split every bucket)
 *   dedicated absent/blank, service key present     -> 'service-derived'
 *   neither                                         -> 'unavailable'
 * 'invalid-config' and 'unavailable' both yield no key, so durable key
 * derivation fails closed (bounded in-memory fallback; never unsalted
 * hashes). The invalid case additionally emits a throttled,
 * identifier-free configuration warning (see warnInvalidConfig).
 */
export function limiterKeySource(env: Record<string, string | undefined> = process.env): LimiterKeySource {
  const dedicated = env.SUPPLIER_RATE_LIMIT_SECRET?.trim();
  if (dedicated) return dedicated.length >= 32 ? 'dedicated' : 'invalid-config';
  if (env.SUPABASE_SERVICE_ROLE_KEY?.trim()) return 'service-derived';
  return 'unavailable';
}

export function resolveLimiterKey(): { key: Buffer | null; source: LimiterKeySource } {
  const source = limiterKeySource();
  if (source === 'dedicated') return { key: deriveLimiterKey(process.env.SUPPLIER_RATE_LIMIT_SECRET!.trim()), source };
  if (source === 'service-derived') return { key: deriveLimiterKey(process.env.SUPABASE_SERVICE_ROLE_KEY!.trim()), source };
  return { key: null, source };
}

function configuredKey(): Buffer | null {
  return resolveLimiterKey().key;
}

/** Ephemeral per-process salt used ONLY for in-memory fallback keys. */
const processSalt = randomBytes(32);

/**
 * Resolves the bucket key for `value`. Returns null when no server secret
 * is configured — callers must treat that as "DB path unavailable" and
 * must NOT substitute a predictable hash.
 */
export function hashLimiterKey(kind: 'phone' | 'client', value: string, key: Buffer | null = configuredKey()): string | null {
  if (!key) return null;
  return hmacLimiterKey(kind, value, key);
}

/** Key for the in-memory fallback: keyed when possible, else process-salted. */
function fallbackKey(kind: 'phone' | 'client', value: string): string {
  const key = configuredKey();
  if (key) return hmacLimiterKey(kind, value, key);
  return createHmac('sha256', processSalt).update(`supplier-app:fallback:${kind}:${value}`, 'utf8').digest('hex');
}

// ---------------------------------------------------------------------------
// Client identity (best-effort bucket identity — never a trusted identity)
// ---------------------------------------------------------------------------

export function clientIdentityFromHeaders(get: (name: string) => string | null): string | null {
  const forwarded = get('x-forwarded-for');
  const first = forwarded?.split(',')[0]?.trim() ?? '';
  if (!/^[0-9a-fA-F:.]{3,45}$/.test(first) || !/[0-9]/.test(first)) return null;
  return first;
}

// ---------------------------------------------------------------------------
// Bounded in-memory fallback (F3)
// ---------------------------------------------------------------------------

export const FALLBACK_MAX_ENTRIES = 10_000;

interface FallbackEntry {
  count: number;
  resetAt: number;
}

export const EXPIRY_SWEEP_BUDGET = 64;

/**
 * Fixed-window limiter with strictly bounded memory and bounded
 * per-request work (audit N2/N3):
 *
 * - LRU policy: the Map is kept in least-recently-used order; consuming
 *   an existing key refreshes its recency. When size would exceed
 *   maxEntries, least-recently-used entries are evicted first. The
 *   just-consumed key is evicted only if it is the sole remaining entry
 *   above the cap (maxEntries < 1 edge), so `size <= maxEntries` holds
 *   after EVERY consume — no exceptions, no infinite loop.
 * - Expiry is incremental, not a full-map sweep: window creations push
 *   one record onto an expiry queue; each consume processes at most
 *   EXPIRY_SWEEP_BUDGET due records from the front. Repeated updates to
 *   a live key push nothing. Stale records (superseded windows, evicted
 *   keys) are recognised by resetAt mismatch and discarded. The queue
 *   is compacted/rebuilt from the live map if it ever exceeds
 *   2 * maxEntries pending records, so auxiliary memory is bounded too
 *   (rebuild is O(maxEntries) after at least maxEntries pushes —
 *   amortized O(1) per consume). The accessed key itself is always
 *   expiry-checked directly, so fixed-window boundaries are exact even
 *   before the sweep reaches an entry.
 * - ACCEPTED LIMITATION, stated plainly: under memory pressure (more
 *   distinct live keys than maxEntries — 10,000 by default, far above
 *   any legitimate working set), evicting a still-active key forgets
 *   its count, so that key's next consume starts a fresh window. No
 *   bounded-memory design can avoid this without unbounded tombstones;
 *   the durable DB limiter remains the real control whenever it is up.
 */
export class BoundedWindowLimiter {
  private readonly entries = new Map<string, FallbackEntry>();
  private expiryQueue: Array<{ key: string; resetAt: number }> = [];
  private expiryHead = 0;

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly maxEntries: number = FALLBACK_MAX_ENTRIES
  ) {}

  get size(): number {
    return this.entries.size;
  }

  /** Pending expiry-queue records (bounded; exposed for tests). */
  get pendingExpiryRecords(): number {
    return this.expiryQueue.length - this.expiryHead;
  }

  private sweepExpired(now: number): void {
    let processed = 0;
    while (this.expiryHead < this.expiryQueue.length && processed < EXPIRY_SWEEP_BUDGET) {
      const rec = this.expiryQueue[this.expiryHead]!;
      if (rec.resetAt > now) break;
      this.expiryHead += 1;
      processed += 1;
      const entry = this.entries.get(rec.key);
      if (entry && entry.resetAt === rec.resetAt) this.entries.delete(rec.key);
    }
    if (this.expiryHead === this.expiryQueue.length) {
      this.expiryQueue = [];
      this.expiryHead = 0;
    } else if (this.pendingExpiryRecords > 2 * this.maxEntries) {
      // Bound auxiliary memory: rebuild from live entries only.
      this.expiryQueue = [...this.entries].map(([key, e]) => ({ key, resetAt: e.resetAt }));
      this.expiryHead = 0;
    }
  }

  consume(key: string, now: number): { allowed: boolean; retryAfterSeconds: number } {
    this.sweepExpired(now);
    const existing = this.entries.get(key);
    let entry: FallbackEntry;
    if (existing && existing.resetAt > now) {
      entry = { count: existing.count + 1, resetAt: existing.resetAt };
      this.entries.delete(key); // refresh LRU recency
      this.entries.set(key, entry);
    } else {
      if (existing) this.entries.delete(key); // expired: its queue record is now stale
      entry = { count: 1, resetAt: now + this.windowMs };
      this.entries.set(key, entry);
      this.expiryQueue.push({ key, resetAt: entry.resetAt });
    }
    // Enforce the cap after every consume, evicting LRU first. The
    // current key is the victim only when nothing else remains.
    while (this.entries.size > this.maxEntries) {
      let victim: string | undefined;
      for (const k of this.entries.keys()) {
        if (k !== key) { victim = k; break; }
      }
      victim ??= key;
      this.entries.delete(victim);
      if (victim === key) break;
    }
    const allowed = entry.count <= this.limit;
    return {
      allowed,
      retryAfterSeconds: allowed ? 0 : Math.max(1, Math.ceil((entry.resetAt - now) / 1000)),
    };
  }
}

const phoneFallback = new BoundedWindowLimiter(SUPPLIER_PHONE_LIMIT.limit, SUPPLIER_PHONE_LIMIT.windowSeconds * 1000);
const clientFallback = new BoundedWindowLimiter(SUPPLIER_CLIENT_LIMIT.limit, SUPPLIER_CLIENT_LIMIT.windowSeconds * 1000);

// ---------------------------------------------------------------------------
// Warning throttle (F6): at most one outage warning per minute per process.
// ---------------------------------------------------------------------------

const WARN_INTERVAL_MS = 60_000;
let lastWarnAt = -Infinity;

/** Returns true when a warning may be emitted now (deterministic via `now`). */
export function shouldWarn(now: number): boolean {
  // Defensive (audit N6): a non-finite clock must neither warn on every
  // call nor poison the throttle state.
  if (!Number.isFinite(now)) return false;
  if (now - lastWarnAt < WARN_INTERVAL_MS) return false;
  lastWarnAt = now;
  return true;
}

let lastConfigWarnAt = -Infinity;

/** Throttled, identifier-free warning for the N4 invalid-config case. */
function warnInvalidConfig(now: number): void {
  if (!Number.isFinite(now) || now - lastConfigWarnAt < WARN_INTERVAL_MS) return;
  lastConfigWarnAt = now;
  console.warn('[suppliers] SUPPLIER_RATE_LIMIT_SECRET is configured but invalid; durable rate limiting disabled');
}

function warnUnavailable(now: number): void {
  if (shouldWarn(now)) {
    console.warn('[suppliers] durable rate limiter unavailable; using in-memory fallback');
  }
}

// ---------------------------------------------------------------------------
// RPC result validation (F5) + limiter
// ---------------------------------------------------------------------------

export interface SupplierLimitDecision {
  allowed: boolean;
  source: 'database' | 'memory-fallback';
  retryAfterSeconds: number;
}

interface RpcResult {
  allowed: boolean;
  remaining: number;
  retry_after_seconds: number;
}

/**
 * Validates an RPC payload against the 0060 contract. Anything malformed
 * (null, array, missing/ mistyped fields, out-of-range numbers) returns
 * null, i.e. "durable path unavailable" → the documented fail-open
 * fallback, never a silent block or a silent pass.
 */
export function parseRpcResult(data: unknown): RpcResult | null {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return null;
  const d = data as Record<string, unknown>;
  if (typeof d.allowed !== 'boolean') return null;
  if (typeof d.remaining !== 'number' || !Number.isFinite(d.remaining) || d.remaining < 0 || d.remaining > 1_000_000) return null;
  if (
    typeof d.retry_after_seconds !== 'number' ||
    !Number.isFinite(d.retry_after_seconds) ||
    d.retry_after_seconds < 0 ||
    d.retry_after_seconds > 86_400
  ) {
    return null;
  }
  return { allowed: d.allowed, remaining: d.remaining, retry_after_seconds: d.retry_after_seconds };
}

type RpcCaller = (bucket: string, keyHash: string, limit: number, windowSeconds: number) => Promise<unknown>;

export class SupplierSubmissionLimiter {
  constructor(private readonly rpc: RpcCaller) {}

  private async tryRpc(bucket: string, keyHash: string, limit: number, windowSeconds: number): Promise<RpcResult | null> {
    try {
      return parseRpcResult(await this.rpc(bucket, keyHash, limit, windowSeconds));
    } catch {
      return null;
    }
  }

  async consume(phone: string, clientIdentity: string | null, now = Date.now()): Promise<SupplierLimitDecision> {
    const { key, source } = resolveLimiterKey();
    if (source === 'invalid-config') warnInvalidConfig(now);
    const phoneHash = key ? hmacLimiterKey('phone', phone, key) : null;

    if (phoneHash) {
      // Client bucket FIRST (F7): a client-level rejection must not burn
      // the scarcer phone quota. The calls are not transactional — if the
      // phone check then rejects, one client token was consumed.
      if (clientIdentity) {
        const clientHash = hmacLimiterKey('client', clientIdentity, key!);
        const clientResult = await this.tryRpc(
          'supplier-app-client',
          clientHash,
          SUPPLIER_CLIENT_LIMIT.limit,
          SUPPLIER_CLIENT_LIMIT.windowSeconds
        );
        if (clientResult && !clientResult.allowed) {
          return { allowed: false, source: 'database', retryAfterSeconds: clientResult.retry_after_seconds };
        }
        // clientResult === null: that bucket's durable check failed; the
        // phone decision below still stands on the durable path.
      }
      const phoneResult = await this.tryRpc(
        'supplier-app-phone',
        phoneHash,
        SUPPLIER_PHONE_LIMIT.limit,
        SUPPLIER_PHONE_LIMIT.windowSeconds
      );
      if (phoneResult) {
        return phoneResult.allowed
          ? { allowed: true, source: 'database', retryAfterSeconds: 0 }
          : { allowed: false, source: 'database', retryAfterSeconds: phoneResult.retry_after_seconds };
      }
    }

    // Fail-open fallback (documented in the header). When no secret is
    // configured the DB path is skipped entirely — never unsalted keys.
    warnUnavailable(now);
    const phoneDecision = phoneFallback.consume(`phone:${fallbackKey('phone', phone)}`, now);
    if (!phoneDecision.allowed) {
      return { allowed: false, source: 'memory-fallback', retryAfterSeconds: phoneDecision.retryAfterSeconds };
    }
    if (clientIdentity) {
      const clientDecision = clientFallback.consume(`client:${fallbackKey('client', clientIdentity)}`, now);
      if (!clientDecision.allowed) {
        return { allowed: false, source: 'memory-fallback', retryAfterSeconds: clientDecision.retryAfterSeconds };
      }
    }
    return { allowed: true, source: 'memory-fallback', retryAfterSeconds: 0 };
  }
}

type LimiterRpcClient = {
  rpc: (fn: never, args: never) => PromiseLike<{ data: unknown; error: unknown }>;
};

/**
 * Builds the production limiter from a client FACTORY (audit F-1).
 * Constructing the privileged (service-role) client can itself throw
 * on missing/invalid server configuration; previously that exception
 * escaped before the limiter existed, aborting public registration
 * instead of reaching the documented fail-open fallback. Construction
 * failure is therefore converted into "durable RPC unavailable" — the
 * exact same policy as an RPC error — and the bounded in-memory
 * fallback decides. Only construction is caught here: validation,
 * submission, and authorization failures elsewhere are unaffected.
 */
export function createSupplierSubmissionLimiterFromFactory(
  factory: () => LimiterRpcClient
): SupplierSubmissionLimiter {
  try {
    return createSupplierSubmissionLimiter(factory());
  } catch {
    return new SupplierSubmissionLimiter(async () => null);
  }
}

/** Builds the production limiter on top of the caller's Supabase client. */
export function createSupplierSubmissionLimiter(supabase: LimiterRpcClient): SupplierSubmissionLimiter {
  return new SupplierSubmissionLimiter(async (bucket, keyHash, limit, windowSeconds) => {
    const { data, error } = await supabase.rpc('consume_supplier_application_rate_limit' as never, {
      p_key_hash: keyHash,
      p_bucket: bucket,
      p_limit: limit,
      p_window_seconds: windowSeconds,
    } as never);
    if (error) return null;
    return data;
  });
}
